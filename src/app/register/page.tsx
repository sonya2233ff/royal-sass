import { AccountScreen } from "../account/AccountScreen";

export const metadata = {
  title: "Реєстрація — Royal SASS",
  description: "Створити обліковий запис кафе",
};

export default function RegisterPage() {
  return <AccountScreen mode="register" />;
}
