import { WaiterPortal } from "./WaiterPortal";

export const metadata = {
  title: "Офіціант — Royal SASS",
  description: "Портал офіціанта: список продуктів для водія",
};

export default function WaiterPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 520px at 90% -20%, #e4ddd0 0%, transparent 50%), linear-gradient(165deg, #f7f3ec 0%, #ebe4d6 48%, #f3eee4 100%)",
      }}
    >
      <WaiterPortal />
    </main>
  );
}
