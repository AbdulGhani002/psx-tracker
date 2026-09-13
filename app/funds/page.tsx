import { redirect } from "next/navigation";

// Moved into the portfolio tabs.
export default function Page() {
  redirect("/portfolio?tab=cash");
}
