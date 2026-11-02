import { notFound } from "next/navigation";
import { findDay } from "../data";
import { ActivityDay } from "./ActivityDay";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return {
    title: `Чек ${date} — Royal SASS`,
    description: "Деталі покупок за день і фото чека від водія",
  };
}

export default async function ActivityDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const day = findDay(date);
  if (!day) notFound();

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 520px at 8% -18%, #d9e4d8 0%, transparent 52%), linear-gradient(165deg, #f3eee4 0%, #e7eee8 46%, #f7f3ec 100%)",
      }}
    >
      <ActivityDay day={day} />
    </main>
  );
}
