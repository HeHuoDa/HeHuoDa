import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { prepareH5Entry } from "./navigation/h5-entry";

export function createApp() {
  prepareH5Entry();
  const app = createSSRApp(App);
  app.use(createPinia());
  return { app };
}
