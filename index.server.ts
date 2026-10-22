import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(preferences);
  return () => {};
}
