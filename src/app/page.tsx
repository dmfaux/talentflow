import { Landing } from "@/components/marketing/landing";
import { getPublicPlanCards } from "@/lib/public-plans";

// The public marketing home. A thin Server Component so the pricing cards can be
// read from the DB (visibility + redaction flags live on the `plans` table) and
// passed to the client view. The route is statically rendered and regenerated
// on demand: /api/operator/plans calls revalidatePath("/") whenever an operator
// toggles a plan, so changes show up without a redeploy.
export default async function Page() {
  const plans = await getPublicPlanCards();
  return <Landing plans={plans} />;
}
