import { BusinessLocationScreen } from "../business/BusinessLocationScreen";

export const metadata = {
  title: "Налаштування — Royal SASS",
  description: "Витрати на дорогу і параметри закладу",
};

export default function SettingsPage() {
  return <BusinessLocationScreen section="settings" />;
}
