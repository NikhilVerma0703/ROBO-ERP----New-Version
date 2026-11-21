import { redirect } from "next/navigation";

// STANDALONE: opening http://localhost:3000 lands straight on Robo.
//
// In Pacific ERP, "/" is each login's own home page, and the Robo login's home
// is the module. Here there is no login and the module is the app, so "/" goes
// to Robo Entry (app/robo/page.tsx).
export default function Home() {
  redirect("/robo");
}
