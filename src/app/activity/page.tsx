import { ActivityPortal } from "./ActivityPortal";

export const metadata = {
  title: "Історія — Royal SASS",
  description: "Історія покупок по днях: чек і заощадження по кожному продукту",
};

export default function ActivityPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 520px at 8% -18%, #d9e4d8 0%, transparent 52%), linear-gradient(165deg, #f3eee4 0%, #e7eee8 46%, #f7f3ec 100%)",
      }}
    >
      <ActivityPortal />
    </main>
  );
}
