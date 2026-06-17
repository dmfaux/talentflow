import { redirect } from "next/navigation";

// S8: the direct create-user form is retired — new members join through the
// invite flow (S5 mandate: new-user form → invite flow). Anyone landing on the
// old route is sent back to Members, where "Invite member" lives. The route is
// kept (rather than deleted) so existing links don't 404; S14 finishes the move.
export default function NewUserRetiredPage() {
  redirect("/users");
}
