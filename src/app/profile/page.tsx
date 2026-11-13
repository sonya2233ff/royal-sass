import { BusinessLocationScreen } from "../business/BusinessLocationScreen";

export const metadata = {
  title: "Профіль — Royal SASS",
  description: "Акаунт і заклад",
};

export default function ProfilePage() {
  return <BusinessLocationScreen section="profile" />;
}
