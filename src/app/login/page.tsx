import { AccountScreen } from "../account/AccountScreen";

export const metadata = {
  title: "Вхід — Royal SASS",
  description: "Увійти в обліковий запис кафе",
};

export default function LoginPage() {
  return <AccountScreen mode="login" />;
}
