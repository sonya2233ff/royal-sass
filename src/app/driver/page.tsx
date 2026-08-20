import { DriverPortal } from "./DriverPortal";

export const metadata = {
  title: "Водій — Royal SASS",
  description: "Портал водія: списки продуктів від офіціантів",
};

export default function DriverPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1000px 520px at 8% -18%, #d9e4d8 0%, transparent 52%), linear-gradient(165deg, #f3eee4 0%, #e7eee8 46%, #f7f3ec 100%)",
      }}
    >
      <DriverPortal />
    </main>
  );
}
