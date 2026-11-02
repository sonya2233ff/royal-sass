import { notFound } from "next/navigation";
import { findDay } from "../data";
import { ActivityDayLoader } from "./ActivityDayLoader";

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 520px at 8% -18%, #d9e4d8 0%, transparent 52%), linear-gradient(165deg, #f3eee4 0%, #e7eee8 46%, #f7f3ec 100%)",
      }}
    >
      <ActivityDayLoader date={date} seed={findDay(date)} />
    </main>
  );
}
