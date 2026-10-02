"""PSX-Net: a cross-sectional transformer for ranking PSX names, trained on the GPU.

For every trading day, every name in the universe is one token:

  history   the name's last 40 sessions (return, return against the market,
            volume surprise, each in units of the name's own volatility),
            read by a small temporal transformer: what the name has been doing
  features  the 59 features the boosted trees read (momentum, volatility,
            liquidity, seasonality, market state), as the day's percentile
            ranks, through a residual MLP: where the name stands today
  market    a transformer across the day's names: each name's reading is
            adjusted by every other name's, so a name is judged against the
            market of that day, not in isolation

The score head is trained to maximise the day's rank correlation (IC) between
score and the next 20 sessions' return against the market, the measure the
model is judged on; three side heads (up, beats the market, dips 5% first)
share the body as a regulariser.

Walk-forward, exactly as the boosted trees: train on every day up to `horizon`
sessions before a window, predict the window's 250 sessions, step on; the
validation slice for early stopping is the newest tenth of the training days,
behind a gap of `horizon` sessions.

  python ml/psxnet.py walk  --data C:/CC/Data/psx-net --variant full --seeds 3 --out C:/CC/Data/psx-net/oos-full.f32
  python ml/psxnet.py final --data C:/CC/Data/psx-net --variant full --seeds 5 --epochs 9 --out C:/CC/Data/psx-net/model-full.json

The GELU is the tanh form and every attention is written out by hand, so the
TypeScript forward pass (lib/quant/net-infer.ts) can reproduce it exactly.
"""

import argparse
import json
import math
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SEQ_LEN = 40

# The index's own state (returns, trend, volatility, drawdown): the same for
# every name on a day, so its cross-sectional rank is noise (ties broken by
# each name's own trading days). With --day-raw the network reads the day's
# value instead, the median of the names' raw readings.
DAY_FEATURES = ["idxRet1", "idxRet5", "idxRet20", "idxMa50_200", "idxVol20", "idxDd250"]


# --------------------------------------------------------------------- data

class Panel:
    def __init__(self, path, device, day_raw=False):
        meta = json.load(open(os.path.join(path, "meta.json")))
        self.meta = meta
        n, self.dX = meta["rows"], meta["dXs"]
        self.C = meta["seqChannels"]
        self.nDates, self.nSym = len(meta["dates"]), len(meta["symbols"])
        self.horizon = meta["horizon"]
        rd = lambda f, dt: np.fromfile(os.path.join(path, f), dtype=dt)
        self.di = rd("di.i32", np.int32)
        self.sym = rd("sym.i32", np.int32)
        xs = rd("xs.f32", np.float32).reshape(n, self.dX)
        y = rd("y.f32", np.float32).reshape(n, 10)
        fwd = rd("fwd.f32", np.float32).reshape(n, 2)
        seq = rd("seq.f32", np.float32).reshape(self.nSym, self.nDates, self.C)
        self.n = n
        # Row range of each date (rows are sorted by date, then name).
        self.starts = np.searchsorted(self.di, np.arange(self.nDates + 1)).astype(np.int64)
        self.dayRaw = []
        if day_raw:
            x = rd("x.f32", np.float32).reshape(n, self.dX)
            for name in DAY_FEATURES:
                j = meta["featureNames"].index(name)
                col = xs[:, j].copy()
                for d in range(self.nDates):
                    s, e = int(self.starts[d]), int(self.starts[d + 1])
                    if e > s:
                        col[s:e] = np.median(x[s:e, j])
                xs[:, j] = col
                self.dayRaw.append(j)
            del x
        self.dev = device
        self.xs = torch.tensor(xs, device=device)
        self.y = torch.tensor(y, device=device)
        self.fwdRel = torch.tensor(fwd[:, 1], device=device)
        seq_t = torch.tensor(seq, device=device)
        self.seqMask = ~torch.isnan(seq_t[..., 0])
        self.seq = torch.nan_to_num(seq_t, nan=0.0)
        self.symT = torch.tensor(self.sym.astype(np.int64), device=device)
        self.diT = torch.tensor(self.di.astype(np.int64), device=device)
        self.maxN = int(np.max(np.diff(self.starts)))
        # The calendar runs to the last session (the history windows need it);
        # rows only to the last date whose outcome is known.
        self.has = np.diff(self.starts) > 0
        self.nRowDates = int(np.nonzero(self.has)[0].max()) + 1

    def nonempty(self, dates):
        dates = np.asarray(dates, dtype=np.int64)
        return dates[self.has[dates]]

    def windows(self, min_train=750, step=250):
        out = []
        for start in range(min_train, self.nRowDates, step):
            out.append((start - self.horizon, start, min(start + step, self.nRowDates)))
        return out

    def batch(self, dates, mean, std):
        """Padded tensors for a list of date indices."""
        counts = [int(self.starts[d + 1] - self.starts[d]) for d in dates]
        N = max(counts)
        B = len(dates)
        idx = torch.full((B, N), -1, dtype=torch.long, device=self.dev)
        for b, d in enumerate(dates):
            s, e = int(self.starts[d]), int(self.starts[d + 1])
            idx[b, : e - s] = torch.arange(s, e, device=self.dev)
        mask = idx >= 0
        safe = idx.clamp(min=0)
        tab = (self.xs[safe] - mean) / std
        tab = tab * mask[..., None]
        sym = self.symT[safe]
        day = self.diT[safe]
        steps = torch.arange(SEQ_LEN, device=self.dev) - (SEQ_LEN - 1)
        t_idx = day[..., None] + steps  # B, N, L
        ok = (t_idx >= 0) & mask[..., None]
        t_safe = t_idx.clamp(min=0)
        seq = self.seq[sym[..., None], t_safe]  # B, N, L, C
        seqm = self.seqMask[sym[..., None], t_safe] & ok
        seq = seq * seqm[..., None]
        return tab, seq, seqm, mask, safe


# -------------------------------------------------------------------- model

class Attn(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.h, self.dh = heads, d // heads
        self.qkv = nn.Linear(d, 3 * d)
        self.o = nn.Linear(d, d)

    def forward(self, x, mask):  # x [B, T, d], mask [B, T] True where real
        B, T, d = x.shape
        q, k, v = self.qkv(x).view(B, T, 3, self.h, self.dh).permute(2, 0, 3, 1, 4)
        s = (q @ k.transpose(-1, -2)) / math.sqrt(self.dh)
        s = s.masked_fill(~mask[:, None, None, :], -1e9)
        a = s.softmax(-1)
        return self.o((a @ v).transpose(1, 2).reshape(B, T, d))


class Block(nn.Module):
    """Pre-norm transformer block."""

    def __init__(self, d, heads, ff, drop):
        super().__init__()
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.attn = Attn(d, heads)
        self.f1, self.f2 = nn.Linear(d, ff), nn.Linear(ff, d)
        self.drop = nn.Dropout(drop)

    def forward(self, x, mask):
        x = x + self.drop(self.attn(self.ln1(x), mask))
        return x + self.drop(self.f2(self.drop(F.gelu(self.f1(self.ln2(x)), approximate="tanh"))))


class ResMLP(nn.Module):
    def __init__(self, d, ff, drop):
        super().__init__()
        self.ln = nn.LayerNorm(d)
        self.f1, self.f2 = nn.Linear(d, ff), nn.Linear(ff, d)
        self.drop = nn.Dropout(drop)

    def forward(self, x):
        return x + self.drop(self.f2(self.drop(F.gelu(self.f1(self.ln(x)), approximate="tanh"))))


class Temporal(nn.Module):
    def __init__(self, C, d, layers, heads, drop):
        super().__init__()
        self.inp = nn.Linear(C + 1, d)
        self.pos = nn.Parameter(torch.randn(SEQ_LEN, d) * 0.02)
        self.blocks = nn.ModuleList([Block(d, heads, 2 * d, drop) for _ in range(layers)])
        self.ln = nn.LayerNorm(d)

    def forward(self, s, m):  # s [M, L, C], m [M, L]
        h = self.inp(torch.cat([s, m[..., None].float()], -1)) + self.pos
        for b in self.blocks:
            h = b(h, m)
        h = self.ln(h)
        mf = m[..., None].float()
        mean = (h * mf).sum(1) / mf.sum(1).clamp(min=1.0)
        return torch.cat([h[:, -1], mean], -1)


VARIANTS = {
    # name: (temporal history, cross-sectional attention)
    "mlp": (False, False),
    "xs": (False, True),
    "seq": (True, False),
    "full": (True, True),
}


class PSXNet(nn.Module):
    def __init__(self, dTab, C, variant="full", d=64, td=32, blocks=2, xs_layers=2, t_layers=2, heads=4, drop=0.1):
        super().__init__()
        self.use_seq, self.use_xs = VARIANTS[variant]
        self.cfg = dict(dTab=dTab, C=C, variant=variant, d=d, td=td, blocks=blocks, xs_layers=xs_layers, t_layers=t_layers, heads=heads, drop=drop, L=SEQ_LEN)
        self.tab_in = nn.Linear(dTab, d)
        self.tab_blocks = nn.ModuleList([ResMLP(d, 2 * d, drop) for _ in range(blocks)])
        if self.use_seq:
            self.temporal = Temporal(C, td, t_layers, heads, drop)
            self.fuse = nn.Linear(d + 2 * td, d)
        self.xs_blocks = nn.ModuleList([Block(d, heads, 2 * d, drop) for _ in range(xs_layers)]) if self.use_xs else nn.ModuleList()
        self.ln = nn.LayerNorm(d)
        self.score = nn.Linear(d, 1)
        self.aux = nn.Linear(d, 3)

    def forward(self, tab, seq, seqm, mask):
        h = self.tab_in(tab)
        for b in self.tab_blocks:
            h = b(h)
        if self.use_seq:
            B, N = mask.shape
            e = self.temporal(seq.reshape(B * N, SEQ_LEN, -1), seqm.reshape(B * N, SEQ_LEN)).view(B, N, -1)
            h = self.fuse(torch.cat([h, e], -1))
        for b in self.xs_blocks:
            h = b(h, mask)
        h = self.ln(h)
        return self.score(h).squeeze(-1), self.aux(h)


# ------------------------------------------------------------------ training

def ic_loss(score, target, mask):
    m = mask.float()
    cnt = m.sum(1).clamp(min=2)
    sm = (score * m).sum(1) / cnt
    tm = (target * m).sum(1) / cnt
    sc, tc = (score - sm[:, None]) * m, (target - tm[:, None]) * m
    corr = (sc * tc).sum(1) / (sc.pow(2).sum(1).sqrt() * tc.pow(2).sum(1).sqrt() + 1e-8)
    return -corr.mean()


def xs_rank(target, mask):
    """The day's returns as ranks, -0.5 to 0.5: the loss then rewards the order
    the score is judged on, and one stock up 80% cannot dominate the day."""
    t = target.masked_fill(~mask, float("inf"))
    r = t.argsort(1).argsort(1).float()
    n = mask.float().sum(1, keepdim=True).clamp(min=2)
    return ((r + 0.5) / n - 0.5) * mask


def rank_ic(score, fwd, mask):
    """Mean over dates of the Spearman correlation, masked."""
    out = []
    for b in range(score.shape[0]):
        k = mask[b]
        if k.sum() < 8:
            continue
        s, f = score[b][k], fwd[b][k]
        rs = s.argsort().argsort().float()
        rf = f.argsort().argsort().float()
        rs, rf = rs - rs.mean(), rf - rf.mean()
        out.append(float((rs * rf).sum() / (rs.norm() * rf.norm() + 1e-8)))
    return out


def train_one(P, train_dates, val_dates, variant, seed, epochs, batch, lr, aux_w, log=None, drop=0.1, wd=1e-2, rank=False):
    torch.manual_seed(seed)
    np.random.seed(seed)
    train_dates, val_dates = P.nonempty(train_dates), P.nonempty(val_dates)
    rows = slice(int(P.starts[train_dates[0]]), int(P.starts[train_dates[-1] + 1]))
    mean = P.xs[rows].mean(0)
    std = P.xs[rows].std(0).clamp(min=1e-4)
    net = PSXNet(P.dX, P.C, variant, drop=drop).to(P.dev)
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=wd)
    steps_per = math.ceil(len(train_dates) / batch)
    total = steps_per * epochs
    warm = max(1, int(0.05 * total))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total)))))
    best, best_ep, best_state, stale = -9, 0, None, 0
    rng = np.random.default_rng(seed)
    for ep in range(epochs):
        net.train()
        order = rng.permutation(train_dates)
        t0 = time.time()
        for i in range(0, len(order), batch):
            tab, seq, seqm, mask, safe = P.batch(order[i : i + batch], mean, std)
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=P.dev.type == "cuda"):
                score, aux = net(tab, seq, seqm, mask)
            score, aux = score.float(), aux.float()
            target = P.y[safe][..., 3]
            if rank:
                target = xs_rank(target, mask)
            loss = ic_loss(score, target, mask)
            if aux_w > 0:
                yt = P.y[safe][..., :3]
                bce = F.binary_cross_entropy_with_logits(aux, yt, reduction="none").mean(-1)
                loss = loss + aux_w * (bce * mask).sum() / mask.sum()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            sched.step()
        if len(val_dates) == 0:
            # The final model: no slice to judge by, the epoch count is given.
            best_ep = ep + 1
            if log:
                log(f"    epoch {ep + 1:2d}  {time.time() - t0:.0f}s")
            continue
        ic = np.mean(predict_ic(P, net, val_dates, mean, std))
        if log:
            log(f"    epoch {ep + 1:2d}  val IC {ic:+.4f}  {time.time() - t0:.0f}s")
        if ic > best + 1e-4:
            best, best_ep, stale = ic, ep + 1, 0
            best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
        else:
            stale += 1
            if stale >= 4:
                break
    if best_state is not None:
        net.load_state_dict(best_state)
    return net, mean, std, best_ep, best


@torch.no_grad()
def predict_ic(P, net, dates, mean, std, batch=32):
    net.eval()
    dates = P.nonempty(dates)
    ics = []
    for i in range(0, len(dates), batch):
        tab, seq, seqm, mask, safe = P.batch(dates[i : i + batch], mean, std)
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=P.dev.type == "cuda"):
            score, _ = net(tab, seq, seqm, mask)
        ics += rank_ic(score.float(), P.fwdRel[safe], mask)
    return ics


@torch.no_grad()
def predict_scores(P, net, dates, mean, std, out, batch=32):
    """Within-date percentile rank of the score, written at each row's place."""
    net.eval()
    dates = P.nonempty(dates)
    for i in range(0, len(dates), batch):
        tab, seq, seqm, mask, safe = P.batch(dates[i : i + batch], mean, std)
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=P.dev.type == "cuda"):
            score, _ = net(tab, seq, seqm, mask)
        score = score.float()
        for b in range(score.shape[0]):
            k = mask[b]
            s = score[b][k]
            r = s.argsort().argsort().float() / max(1, int(k.sum()) - 1)
            out[safe[b][k].cpu().numpy()] += r.cpu().numpy()


def split_dates(train_end, horizon):
    """Training dates up to train_end, the newest tenth held for validation behind a gap."""
    n_val = max(20, int(0.1 * train_end))
    val = np.arange(train_end - n_val, train_end)
    train = np.arange(0, max(1, train_end - n_val - horizon))
    return train, val


def cmd_walk(a):
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    P = Panel(a.data, dev, day_raw=a.day_raw)
    print(f"{P.n:,} rows, {P.nSym} names, {P.nDates} dates, {P.dX} features, device {dev}{', index state as the day value' if P.dayRaw else ''}", flush=True)
    wins = P.windows(a.min_train, a.step)
    if a.windows:
        keep = set(int(w) for w in a.windows.split(","))
        wins = [w for k, w in enumerate(wins) if k in keep]
    scores = np.zeros(P.n, dtype=np.float32)
    seen = np.zeros(P.n, dtype=np.float32)
    epochs_kept = []
    t_all = time.time()
    for k, (train_end, start, stop) in enumerate(wins):
        train, val = split_dates(train_end, P.horizon)
        test = np.arange(start, stop)
        t0 = time.time()
        for s in range(a.seeds):
            net, mean, std, ep, ic = train_one(P, train[:: a.thin], val, a.variant, 1000 * k + 17 * s + 7, a.epochs, a.batch, a.lr, a.aux, log=print if a.verbose else None, drop=a.drop, wd=a.wd, rank=a.target == "rank")
            epochs_kept.append(ep)
            predict_scores(P, net, test, mean, std, scores)
            seen[int(P.starts[start]) : int(P.starts[stop])] += 1
            del net
        test_ic = np.mean(predict_ic_from(P, scores, seen, test))
        print(f"  window {k + 1}/{len(wins)} {P.meta['dates'][start][:4]}: train {len(train)} days, best epochs {epochs_kept[-a.seeds:]}, test IC {test_ic:+.4f}  {time.time() - t0:.0f}s", flush=True)
    out = np.where(seen > 0, scores / np.maximum(seen, 1), np.nan).astype(np.float32)
    out.tofile(a.out)
    json.dump({"variant": a.variant, "seeds": a.seeds, "epochs": a.epochs, "dayRaw": a.day_raw, "lr": a.lr, "drop": a.drop, "wd": a.wd, "thin": a.thin, "target": a.target, "epochsKept": epochs_kept, "medianEpoch": int(np.median(epochs_kept)), "seconds": round(time.time() - t_all)}, open(a.out + ".json", "w"))
    print(f"done in {time.time() - t_all:.0f}s; median best epoch {int(np.median(epochs_kept))}; wrote {a.out}")


def predict_ic_from(P, scores, seen, dates):
    ics = []
    for d in dates:
        s, e = int(P.starts[d]), int(P.starts[d + 1])
        if e - s < 8 or seen[s] == 0:
            continue
        sc = scores[s:e] / seen[s:e]
        f = P.fwdRel[s:e].cpu().numpy()
        rs, rf = sc.argsort().argsort(), f.argsort().argsort()
        ics.append(np.corrcoef(rs, rf)[0, 1])
    return ics


def cmd_final(a):
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    P = Panel(a.data, dev, day_raw=a.day_raw)
    last = P.nRowDates  # every date with a known outcome
    train = np.arange(0, last)
    models = []
    for s in range(a.seeds):
        torch.manual_seed(1000 + s)
        # No validation slice: the epoch count is the walk-forward's median.
        net, mean, std, ep, _ = train_one(P, train[:: a.thin], np.array([], dtype=np.int64), a.variant, 1000 + 17 * s, a.epochs, a.batch, a.lr, a.aux, log=print if a.verbose else None, drop=a.drop, wd=a.wd, rank=a.target == "rank")
        models.append({"state": {k: v.detach().double().cpu().numpy().round(6).tolist() for k, v in net.state_dict().items()}, "shapes": {k: list(v.shape) for k, v in net.state_dict().items()}})
        print(f"  seed {s + 1}/{a.seeds} trained", flush=True)
    json.dump({"version": 1, "cfg": PSXNet(P.dX, P.C, a.variant, drop=a.drop).cfg, "mean": mean.double().cpu().numpy().round(6).tolist(), "std": std.double().cpu().numpy().round(6).tolist(), "epochs": a.epochs, "seeds": a.seeds, "trainedTo": P.meta["dates"][P.nRowDates - 1], "featureNames": P.meta["featureNames"], "dayRaw": P.dayRaw, "models": models}, open(a.out, "w"))
    print(f"wrote {a.out} ({os.path.getsize(a.out) / 1e6:.1f} MB)")


@torch.no_grad()
def cmd_parity(a):
    """One day's inputs and the first seed's outputs in float32, for the TypeScript forward pass's test."""
    W = json.load(open(a.model))
    P = Panel(a.data, torch.device("cpu"), day_raw=bool(W.get("dayRaw")))
    c = W["cfg"]
    net = PSXNet(c["dTab"], c["C"], c["variant"], d=c["d"], td=c["td"], blocks=c["blocks"], xs_layers=c["xs_layers"], t_layers=c["t_layers"], heads=c["heads"], drop=c["drop"])
    m0 = W["models"][0]
    net.load_state_dict({k: torch.tensor(np.array(v, dtype=np.float32)).reshape(m0["shapes"][k]) for k, v in m0["state"].items()})
    net.eval()
    mean, std = torch.tensor(W["mean"]), torch.tensor(W["std"])
    day = P.nRowDates - 1 - a.back
    tab, seq, seqm, mask, safe = P.batch([day], mean, std)
    score, aux = net(tab, seq, seqm, mask)
    k = mask[0]
    raw = P.xs[safe[0][k]]
    flat = torch.cat([seq[0][k], seqm[0][k][..., None].float()], -1).reshape(int(k.sum()), -1)
    json.dump({"date": P.meta["dates"][day], "tab": raw.tolist(), "seq": flat.tolist(), "score": score[0][k].tolist(), "aux": torch.sigmoid(aux[0][k]).tolist()}, open(a.out, "w"))
    print(f"parity day {P.meta['dates'][day]}: {int(k.sum())} names -> {a.out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["walk", "final", "parity"])
    ap.add_argument("--model", default="")
    ap.add_argument("--back", type=int, default=0)
    ap.add_argument("--data", default="C:/CC/Data/psx-net")
    ap.add_argument("--variant", default="full", choices=list(VARIANTS))
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--aux", type=float, default=0.1)
    ap.add_argument("--drop", type=float, default=0.1)
    ap.add_argument("--wd", type=float, default=1e-2)
    ap.add_argument("--target", default="raw", choices=["raw", "rank"])
    ap.add_argument("--day-raw", dest="day_raw", action="store_true")
    ap.add_argument("--thin", type=int, default=1)
    ap.add_argument("--min-train", dest="min_train", type=int, default=750)
    ap.add_argument("--step", type=int, default=250)
    ap.add_argument("--windows", default="")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    {"walk": cmd_walk, "final": cmd_final, "parity": cmd_parity}[a.cmd](a)


if __name__ == "__main__":
    main()
