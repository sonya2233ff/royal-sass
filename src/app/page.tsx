import { StaplesCompare } from "./StaplesCompare";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 10% -10%, #dfe8df 0%, transparent 55%), linear-gradient(165deg, #f4efe6 0%, #e7eee8 42%, #f1ebe2 100%)",
      }}
    >
      <StaplesCompare />
    </main>
  );
}
