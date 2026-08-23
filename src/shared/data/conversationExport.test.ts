import { Blob } from "buffer";
import {
  buildConversationHtmlBlob,
  conversationHtmlFilename,
  MAX_CONVERSATION_TEMPLATE_BYTES,
  resolveConversationExportAssetOrigin,
} from "./conversationExport";

describe("resolveConversationExportAssetOrigin", () => {
  afterEach(() => {
    delete globalThis.__AGENT_WEBCLIENT_RUNTIME_CONFIG__;
  });

  it.each([
    ["https://share.example.test", "https://share.example.test"],
    ["http://localhost:18181", "http://localhost:18181"],
    ["http://127.0.0.1:18181", "http://127.0.0.1:18181"],
    ["http://[::1]:18181", "http://[::1]:18181"]
  ])("accepts asset origin %s", (configured, expected) => {
    globalThis.__AGENT_WEBCLIENT_RUNTIME_CONFIG__ = {
      CONVERSATION_EXPORT_ASSET_ORIGIN: configured
    };

    expect(resolveConversationExportAssetOrigin()).toBe(expected);
  });

  it.each([
    "http://share.example.test",
    "https://127.0.0.2:18181",
    "https://demo.localhost:18181",
    "https://0.0.0.0:18181",
    "https://user@share.example.test",
    "https://share.example.test/path",
    "https://share.example.test?token=bad",
    "https://share.example.test#fragment"
  ])("rejects invalid asset origin %s", (configured) => {
    globalThis.__AGENT_WEBCLIENT_RUNTIME_CONFIG__ = {
      CONVERSATION_EXPORT_ASSET_ORIGIN: configured
    };

    expect(() => resolveConversationExportAssetOrigin()).toThrow(
      "conversation_export_asset_origin_invalid"
    );
  });
});

describe("buildConversationHtmlBlob", () => {
  beforeEach(() => {
    global.Blob = Blob as unknown as typeof global.Blob;
  });

  it("assembles snapshot and every asset origin as Blob parts", async () => {
    const parse = jest.spyOn(JSON, "parse");
    const stringify = jest.spyOn(JSON, "stringify");
    const html = buildConversationHtmlBlob({
      template:
        "<link href=\"__CONVERSATION_EXPORT_ASSET_ORIGIN__/runtime.css\"><script type=\"application/json\">__CONVERSATION_EXPORT_SNAPSHOT_JSON_V1__</script><script src=\"__CONVERSATION_EXPORT_ASSET_ORIGIN__/runtime.js\"></script>",
      snapshot: new Blob([`{"version":1}`], { type: "application/json" }),
      assetOrigin: "http://127.0.0.1:11961",
    });

    await expect(html.text()).resolves.toBe(
      "<link href=\"http://127.0.0.1:11961/runtime.css\"><script type=\"application/json\">{\"version\":1}</script><script src=\"http://127.0.0.1:11961/runtime.js\"></script>",
    );
    expect(parse).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    parse.mockRestore();
    stringify.mockRestore();
  });

  it("rejects missing or duplicate snapshot markers", () => {
    for (const template of [
      "__CONVERSATION_EXPORT_ASSET_ORIGIN__",
      "__CONVERSATION_EXPORT_SNAPSHOT_JSON_V1____CONVERSATION_EXPORT_SNAPSHOT_JSON_V1____CONVERSATION_EXPORT_ASSET_ORIGIN__",
    ]) {
      expect(() => buildConversationHtmlBlob({
        template,
        snapshot: new Blob(["{}"]),
        assetOrigin: "http://127.0.0.1:11961",
      })).toThrow("conversation_export_template_invalid");
    }
  });

  it("derives an HTML filename from the snapshot filename", () => {
    expect(conversationHtmlFilename("对话.snapshot.json", "chat_1")).toBe("对话.html");
    expect(conversationHtmlFilename("", "chat_1")).toBe("chat_1.html");
  });

  it("rejects a template above 256 KiB before assembling Blob parts", () => {
    expect(() => buildConversationHtmlBlob({
      template: "a".repeat(MAX_CONVERSATION_TEMPLATE_BYTES + 1),
      snapshot: new Blob(["{}"]),
      assetOrigin: "http://127.0.0.1:11961",
    })).toThrow(`limit=${MAX_CONVERSATION_TEMPLATE_BYTES}`);
  });
});
