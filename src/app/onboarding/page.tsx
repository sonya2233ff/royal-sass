import { OnboardingWizard } from "./OnboardingWizard";

export const metadata = {
  title: "Заклад — Royal SASS",
  description: "Знайти кафе і підтвердити адресу для маршрутів закупівель",
};

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
