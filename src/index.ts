import { collect } from "./collect";

export default {
  async scheduled(controller, env) {
    await collect(env, Math.floor(controller.scheduledTime / 1000));
  },
} satisfies ExportedHandler<Env>;
