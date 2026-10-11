import { RoutePlanner } from "@/components/route-planner";

export const dynamic = "force-dynamic";

type PlannerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlannerPage({ searchParams }: PlannerPageProps) {
  const { sample } = await searchParams;
  return <RoutePlanner startWithSample={sample === "1"} />;
}
