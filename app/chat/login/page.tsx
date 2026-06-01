import { redirect } from "next/navigation";

export default function ChatLoginRedirect() {
  redirect("/horizon/login");
}
