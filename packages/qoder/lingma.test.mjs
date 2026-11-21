// Qoder CN Lingma 1.0 (通义灵码) dedicated domains: a domain that answers 404
// at /algo/api/v1/version, as Qoder IDE 1.38.0's probe tells one apart, and
// whose sign-in is the session Qoder CN IDE's worker holds. The shapes are
// Milktea's (plugins Discord 2026-11-03, the redacted gist that was tested on
// a real dedicated host):
// - <cosyHome>/cache/id is the machine id (or <cosyHome>/id), cache/user is
//   base64(AES-128-CBC(JSON)) under key = IV = the id's first 16 chars, and
//   the JSON is { uid, yx_uid, organization_id, organization_name, name,
//   email, security_oauth_token, refresh_token, expire_time, user_type };
// - each SSE event is {"headers":…,"body":"<chunk>","statusCodeValue":…};
// - "Model not exist" (model_not_found) and 105 "Login timeout" are said
//   inside the stream.
// Nothing here reaches the network: fetch is answered in-process.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import { createCipheriv, createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QoderCNAuthPlugin, _internal } from "./index.mjs"

const HOST = "corp.rdc.aliyuncs.com"
const ORIGIN = "https://" + HOST
const CHAT = "/algo/api/v2/service/pro/sse/agent_chat_generation"
const MACHINE = "3f2b9c1e-7a4d-4e8f-9b21-6c0d5e4a1f37"

const real = globalThis.fetch
const saved = {}
let sandbox, cosy, seen, route

beforeAll(() => {
  for (const k of ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "QODERCN_COSY_HOME"]) saved[k] = process.env[k]
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
})
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "qoder-lingma-"))
  // every layout the reader knows sits under the sandbox: none of this
  // machine's own is read
  process.env.HOME = process.env.USERPROFILE = sandbox
  process.env.APPDATA = join(sandbox, "AppData", "Roaming")
  process.env.XDG_CONFIG_HOME = join(sandbox, ".config")
  cosy = join(sandbox, "cosy")
  process.env.QODERCN_COSY_HOME = cosy
  seen = []
  _internal.LINGMA_LISTINGS.clear()
  route = () => new Response("", { status: 404 })
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const body = typeof init.body === "string" ? init.body : ""
    const bodyLength = init.body instanceof Uint8Array ? init.body.length : Buffer.byteLength(body)
    seen.push({ method: init.method ?? "GET", host: u.host, path: u.pathname, search: u.search, headers: new Headers(init.headers), body, bodyLength })
    return route(u.host + u.pathname, { body, headers: new Headers(init.headers) })
  }
})
afterEach(() => {
  globalThis.fetch = real
  rmSync(sandbox, { recursive: true, force: true })
})

// ideCache writes the account the IDE's worker caches, as the gist read it
function ideCache(root, account, { idAtRoot = false, id = MACHINE } = {}) {
  mkdirSync(join(root, "cache"), { recursive: true })
  writeFileSync(join(root, ...(idAtRoot ? ["id"] : ["cache", "id"])), id + "\n")
  const key = Buffer.from(id.slice(0, 16), "utf8")
  const c = createCipheriv("aes-128-cbc", key, key)
  writeFileSync(join(root, "cache", "user"), Buffer.concat([c.update(JSON.stringify(account), "utf8"), c.final()]).toString("base64"))
}
const ACCOUNT = (over = {}) => ({
  uid: "1234567890123456",
  yx_uid: "1234567890123456",
  organization_id: "65f0c1d2e3a4b5c6d7e8f901",
  organization_name: "Corp",
  name: "陈",
  email: "milk@corp.example",
  security_oauth_token: "pt-AbCdEfGhIjKlMnOpQrStUvW",
  refresh_token: "rt-ZyXwVuTsRqPoNmLkJiHgFeD",
  expire_time: Date.now() + 6 * 3600_000,
  user_type: "enterprise_professional",
  ...over,
})

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } })
const frame = (inner, status = 200) => "data:" + JSON.stringify({ headers: { "Content-Type": ["application/json"] }, body: JSON.stringify(inner), statusCodeValue: status }) + "\n\n"
const sse = (...frames) => new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } })
const OK = frame({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }], model: "qmodel_latest" })
const NOT_HERE = frame({ error: { message: "Model not exist.", code: "model_not_found" } }, 400)
const LAPSED = frame({ code: "105", message: "Login timeout" }, 403)

function store(initial) {
  let auth = initial
  return { client: { auth: { set: async ({ body }) => (auth = body) } }, get: async () => auth, auth: () => auth }
}
const lingmaMethod = (hooks) => hooks.auth.methods.find((m) => m.prompts?.some((p) => p.key === "dedicated"))
const signedIn = (over = {}) => ({
  type: "oauth",
  access: "pt-AbCdEfGhIjKlMnOpQrStUvW",
  refresh: "",
  expires: Date.now() + 3_600_000,
  accountId: `milk@corp.example (${HOST})`,
  uid: "1234567890123456",
  email: "milk@corp.example",
  name: "陈",
  machineId: MACHINE,
  deviceToken: "",
  deviceRefresh: "",
  dedicated: HOST,
  lingma: true,
  ...over,
})
const ask = { model: "qmodel_latest", messages: [{ role: "user", content: "hi" }] }
const chats = () => seen.filter((s) => s.path === CHAT)
const sentModel = (s) => JSON.parse(_internal.decodeBody(s.body)).model_config.key

test("the IDE's cache is looked for where Qoder CN IDE keeps it on each system, the override first", () => {
  const home = "/h"
  expect(_internal.lingmaRoots({ QODERCN_COSY_HOME: "/o" }, "darwin", home).slice(0, 2)).toEqual(["/o", join(home, "Library", "Application Support", "QoderCN", "SharedClientCache")])
  expect(_internal.lingmaRoots({ APPDATA: "C:/Users/m/AppData/Roaming" }, "win32", home)[0]).toBe(join("C:/Users/m/AppData/Roaming", "QoderCN", "SharedClientCache"))
  expect(_internal.lingmaRoots({}, "win32", home)[0]).toBe(join(home, "AppData", "Roaming", "QoderCN", "SharedClientCache"))
  expect(_internal.lingmaRoots({ XDG_CONFIG_HOME: "/x" }, "linux", home)[0]).toBe(join("/x", "QoderCN", "SharedClientCache"))
  const linux = _internal.lingmaRoots({}, "linux", home)
  expect(linux).toEqual([join(home, ".config", "QoderCN", "SharedClientCache"), join(home, ".config", "Qoder CN", "SharedClientCache"), join(home, ".lingma", "shared_client"), join(home, ".lingma")])
  // COSY_HOME is the 通义灵码 IDE plugin's own, ahead of the folders it writes
  expect(_internal.lingmaRoots({ COSY_HOME: "/c" }, "win32", home).slice(0, 2)).toEqual(["/c", join(home, "AppData", "Roaming", "QoderCN", "SharedClientCache")])
})

// The vector is a real Windows deployment: its traffic's Cosy-Machineid was
// 36653133-6238-452d-a566-65773a66632d and it had no cache/id at all.
test("a machine id the IDE never wrote is derived as GetMachineId derives it", () => {
  expect(_internal.lingmaMachineIdFrom("6e13b8ee", "fe:fc:aa:bb:cc:dd")).toBe("36653133-6238-452d-a566-65773a66632d")
  // the "w" in addSystemMark is a literal, the rest of the marking is dashes
  expect(_internal.lingmaAddSystemMark("6e13b8eefe:fc:aa:bb:")).toBe("6e13b8e-efew:fc-:aa:bb:")
  // fitLength cuts past its length and repeats short inputs to reach it
  expect(_internal.fitLen("6e13b8ee", 8)).toBe("6e13b8ee")
  expect(_internal.fitLen("fe:fc:aa:bb:cc:dd", 12)).toBe("fe:fc:aa:bb:")
  expect(_internal.fitLen("ab", 5)).toBe("ababa")
})

test("a cache with no cache/id opens under the machine id derived from the volume and MAC", async () => {
  const savedVol = process.env.COSY_VOLUME_SERIAL
  const savedMac = process.env.COSY_MAC
  process.env.COSY_VOLUME_SERIAL = "6e13b8ee"
  process.env.COSY_MAC = "fe:fc:aa:bb:cc:dd"
  try {
    const root = join(sandbox, "derived")
    // the IDE wrote cache/user but never cache/id
    mkdirSync(join(root, "cache"), { recursive: true })
    const id = "36653133-6238-452d-a566-65773a66632d"
    const key = Buffer.from(id.slice(0, 16), "utf8")
    const c = createCipheriv("aes-128-cbc", key, key)
    writeFileSync(join(root, "cache", "user"), Buffer.concat([c.update(JSON.stringify(ACCOUNT()), "utf8"), c.final()]).toString("base64"))

    const got = await _internal.lingmaDecode(root)
    expect(got.machineId).toBe(id)
    expect(got.derivedMachineId).toBe(true)
    expect(got.access).toBe(ACCOUNT().security_oauth_token)

    // key = machineId[:16] is built from the volume serial alone (b0..b6), so
    // a wrong MAC still opens it; a wrong volume serial is what fails
    process.env.COSY_MAC = "aa:bb:cc:dd:ee:ff"
    expect((await _internal.lingmaDecode(root)).machineId).toBe("36653133-6238-452d-a561-61773a62622d")
    process.env.COSY_VOLUME_SERIAL = "12345678"
    const wrong = await _internal.lingmaDecode(root)
    expect(wrong.reason).toContain("derived machine id")
  } finally {
    for (const [k, v] of [["COSY_VOLUME_SERIAL", savedVol], ["COSY_MAC", savedMac]]) v === undefined ? delete process.env[k] : (process.env[k] = v)
  }
})

test("the version the IDE's config.json names is the one the domain is signed with", async () => {
  const root = join(sandbox, "versioned")
  ideCache(root, ACCOUNT())
  writeFileSync(join(root, "config.json"), JSON.stringify({ "cosy.core.version": "2.5.11" }))
  const got = await _internal.lingmaDecode(root)
  expect(got.version).toBe("2.5.11")
  expect(_internal.lingmaSite({ name: "qoder-cn" }, HOST, got.version).cosyVersion).toBe("2.5.11")
  // an IDE that writes no version keeps the package's own
  const bare = join(sandbox, "bare")
  ideCache(bare, ACCOUNT())
  const plain = await _internal.lingmaDecode(bare)
  expect(plain.version).toBe("")
  expect(_internal.lingmaSite({ name: "qoder-cn" }, HOST, plain.version).cosyVersion).toBe("2.5.18")
})

test("lingma:// names a Lingma deployment outright, even where the probe answers", async () => {
  // a 通义灵码 private deployment answers /algo/api/v1/version itself, which the
  // probe would otherwise read as Qoder CN 2.0 and send to the device flow
  route = (hostPath) => (hostPath.endsWith("/algo/api/v1/version") ? new Response("{}", { status: 200 }) : new Response("", { status: 404 }))
  const qoder = await _internal.dedicatedSignIn({ name: "qoder-cn" }, "https://" + HOST)
  expect(qoder.url).toContain("/device/selectAccounts")
  // lingma:// goes to the IDE's cache, whatever the probe said
  await expect(_internal.dedicatedSignIn({ name: "qoder-cn" }, "lingma://" + HOST)).rejects.toThrow(/no Lingma IDE sign-in/)
  // and with the IDE's cache in place it signs in from it
  ideCache(cosy, ACCOUNT())
  const s = await _internal.dedicatedSignIn({ name: "qoder-cn" }, "lingma://" + HOST)
  expect(s.instructions).toContain("Lingma 1.0")
  const account = await s.callback()
  expect(account.uid).toBe(ACCOUNT().uid)
  expect(account.lingma).toBe(true)
})

test("the worker's cache/user opens under its machine id, beside it or at the root", async () => {
  ideCache(join(sandbox, "a"), ACCOUNT())
  ideCache(join(sandbox, "b"), ACCOUNT({ uid: "u-b" }), { idAtRoot: true })
  const a = await _internal.lingmaDecode(join(sandbox, "a"))
  expect(a).toMatchObject({ machineId: MACHINE, uid: "1234567890123456", access: "pt-AbCdEfGhIjKlMnOpQrStUvW", orgId: "65f0c1d2e3a4b5c6d7e8f901", email: "milk@corp.example" })
  expect((await _internal.lingmaDecode(join(sandbox, "b"))).uid).toBe("u-b")
  // another machine's id doesn't open it
  ideCache(join(sandbox, "c"), ACCOUNT())
  writeFileSync(join(sandbox, "c", "cache", "id"), "00000000-0000-0000-0000-000000000000")
  expect((await _internal.lingmaDecode(join(sandbox, "c"))).reason).toContain("doesn't open")
  expect((await _internal.lingmaDecode(join(sandbox, "none"))).reason).toContain("no cache/id")
})

test("a domain that answers 404 at the probe signs in with the account Qoder CN IDE holds, asking the domain nothing else", async () => {
  const end = Date.now() + 6 * 3600_000
  ideCache(cosy, ACCOUNT({ expire_time: end }))
  const m = lingmaMethod(await QoderCNAuthPlugin({ client: store().client }))
  const flow = await m.authorize({ dedicated: `https://${HOST}/` })
  expect(flow.method).toBe("auto")
  expect(flow.instructions).toContain("milk@corp.example")
  const cred = await flow.callback()
  expect(cred).toMatchObject({
    type: "success",
    access: "pt-AbCdEfGhIjKlMnOpQrStUvW",
    refresh: "",
    expires: end,
    uid: "1234567890123456",
    orgId: "65f0c1d2e3a4b5c6d7e8f901",
    machineId: MACHINE,
    accountId: `milk@corp.example (${HOST})`,
    dedicated: HOST,
    lingma: true,
  })
  expect(seen.map((s) => s.host + s.path)).toEqual([HOST + "/algo/api/v1/version"])
})

test("the IDE's own folder is found with no override", async () => {
  delete process.env.QODERCN_COSY_HOME
  const own =
    process.platform === "darwin"
      ? join(sandbox, "Library", "Application Support", "QoderCN", "SharedClientCache")
      : process.platform === "win32"
        ? join(process.env.APPDATA, "QoderCN", "SharedClientCache")
        : join(process.env.XDG_CONFIG_HOME, "QoderCN", "SharedClientCache")
  ideCache(own, ACCOUNT())
  const flow = await lingmaMethod(await QoderCNAuthPlugin({ client: store().client })).authorize({ dedicated: HOST })
  expect((await flow.callback()).machineId).toBe(MACHINE)
})

test("with no IDE sign-in, or a lapsed one, the sign-in says so and where it looked", async () => {
  const m = lingmaMethod(await QoderCNAuthPlugin({ client: store().client }))
  const none = await m.authorize({ dedicated: HOST }).catch((e) => e)
  expect(none.message).toContain("no Lingma IDE sign-in found")
  expect(none.message).toContain(cosy)
  ideCache(cosy, ACCOUNT({ expire_time: Date.now() - 1000 }))
  await expect(m.authorize({ dedicated: HOST })).rejects.toThrow("ended")
})

test("a Lingma account chats on the domain's origin, signed and written as the IDE's worker sends it", async () => {
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  expect(opts.baseURL).toBe(ORIGIN)
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })
  expect(res.status).toBe(200)
  const out = await res.json()
  expect(out.choices[0].message.content).toBe("OK")
  expect(out.model).toBe("qmodel_latest")
  expect(new Set(seen.map((x) => x.host))).toEqual(new Set([HOST]))
  const [c] = chats()
  expect(c.search).toBe("?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1")
  const h = c.headers
  expect(h.get("cosy-clienttype")).toBe("0")
  expect(h.get("cosy-version")).toBe("2.5.18")
  expect(h.get("cosy-machineid")).toBe(MACHINE)
  expect(h.get("cosy-user")).toBe("1234567890123456")
  for (const gone of ["cosy-scene", "cosy-business-product", "cosy-business-type"]) expect([gone, h.get(gone)]).toEqual([gone, null])
  expect(h.get("accept")).toBe("text/event-stream")
  expect(h.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
  const body = JSON.parse(_internal.decodeBody(c.body))
  // the body is the deployment's own shape, not Qoder's: no business record,
  // its own agent/task ids, and chat_context beside the turns
  expect(body).toMatchObject({ chat_task: "FREE_INPUT", agent_id: "agent_chat", task_id: "common_chat", session_type: "assistant", source: 1, version: "3", is_reply: false, is_retry: false })
  expect(body.business).toBeUndefined()
  expect(body.image_urls).toBe(null)
  expect(body.chat_context).toMatchObject({ localeLang: "zh", preferredLanguage: "zh", features: [], imageUrls: null })
  expect(body.messages[0].role).toBe("system")
  expect(typeof body.messages[0].content).toBe("string")
  expect(body.model_config).toMatchObject({ key: "qmodel_latest", format: "dashscope", source: "system" })
})

test("a model the domain refuses inside the stream is followed by the next the IDE knows", async () => {
  for (const refusal of [NOT_HERE, frame({ error: { message: "Model not exist.", code: "model_not_found" } })]) {
    seen = []
    route = (at, { body }) => {
      if (at !== HOST + CHAT) return new Response("", { status: 404 })
      return sse(JSON.parse(_internal.decodeBody(body)).model_config.key === "qmodel_latest" ? refusal : OK)
    }
    const s = store(signedIn())
    const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
    const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify({ ...ask, stream: false }) })
    expect(res.status).toBe(200)
    expect((await res.json()).model).toBe("dashscope_qmodel")
    expect(chats().map(sentModel)).toEqual(["qmodel_latest", "dashscope_qmodel"])
  }
})

test("a 105 said in the stream is asked again with the token the IDE renewed, and saved", async () => {
  ideCache(cosy, ACCOUNT({ security_oauth_token: "pt-Renewed00000000000000000" }))
  route = (at, { headers }) => {
    if (at !== HOST + CHAT) return new Response("", { status: 404 })
    return sse(seen.filter((x) => x.path === CHAT).length === 1 ? LAPSED : OK)
  }
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })
  expect(res.status).toBe(200)
  expect(chats().length).toBe(2)
  expect(s.auth().access).toBe("pt-Renewed00000000000000000")
})

test("a 105 with no newer IDE token is a 401 that marks the sign-in expired", async () => {
  ideCache(cosy, ACCOUNT())
  route = (at) => (at === HOST + CHAT ? sse(LAPSED) : new Response("", { status: 404 }))
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })
  expect(res.status).toBe(401)
  expect(res.headers.get("x-magpie-sign-in")).toBe("expired")
  expect((await res.json()).error.message).toContain("Qoder CN IDE")
  expect(chats().length).toBe(1)
})

test("a token near its end is renewed from the IDE's cache, never by a refresh call", async () => {
  ideCache(cosy, ACCOUNT({ security_oauth_token: "pt-Renewed00000000000000000" }))
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))
  const s = store(signedIn({ expires: Date.now() + 60_000 }))
  const hooks = await QoderCNAuthPlugin({ client: s.client })
  const opts = await hooks.auth.loader(s.get)
  expect((await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })).status).toBe(200)
  expect(s.auth().access).toBe("pt-Renewed00000000000000000")
  expect(seen.map((x) => x.path)).toEqual([_internal.LINGMA_MODELS_PATH, CHAT])
  // magpie's own renewal takes the same, and nothing while the IDE has none newer
  expect(await hooks.auth.refresh(signedIn())).toMatchObject({ access: "pt-Renewed00000000000000000" })
  expect(await hooks.auth.refresh(signedIn({ access: "pt-Renewed00000000000000000" }))).toBeUndefined()
  // a renewal reads the IDE's cache, never the domain
  expect(seen.map((x) => x.path)).toEqual([_internal.LINGMA_MODELS_PATH, CHAT])
})

test("the models offered are the domain's own list, the IDE's three when it can't be read", async () => {
  // the domain names its own keys
  const ORG = "org_glm-latest-coder_de64ea6840e65a7e032cb9bd383a79a3"
  route = (at) =>
    at === HOST + _internal.LINGMA_MODELS_PATH
      ? json({ chat: [
          { key: "default", format: "dashscope", source: "system", display_name: "qwen3", is_vl: true, max_input_tokens: 96000, enable: true },
          { key: ORG, format: "openai", source: "organization", display_name: "glm-latest-coder", is_vl: false, max_input_tokens: 96000, enable: true },
        ] })
      : new Response("", { status: 404 })
  const s = store(signedIn())
  const hooks = await QoderCNAuthPlugin({ client: s.client })
  const ms = await hooks.provider.models({ models: {} }, { auth: s.auth() })
  expect(Object.keys(ms)).toEqual(["default", ORG])
  expect(ms[ORG].name).toBe("glm-latest-coder")
  expect(ms[ORG].api.url).toBe(ORIGIN)
  expect(await hooks.auth.usage(s.get)).toMatchObject({ windows: [], signIn: "kept" })
  expect((await hooks.auth.checkin(s.get)).outcome).toBe("inactive")
  expect(seen.map((x) => x.path)).toEqual([_internal.LINGMA_MODELS_PATH])

  // a list that can't be read keeps the IDE's three
  _internal.LINGMA_LISTINGS.clear()
  seen = []
  route = () => new Response("", { status: 404 })
  const fallback = await QoderCNAuthPlugin({ client: store(signedIn()).client })
  const fm = await fallback.provider.models({ models: {} }, { auth: signedIn() })
  expect(Object.keys(fm)).toEqual(["qmodel_latest", "dashscope_qmodel", "q36fmodel"])
  expect(fm.qmodel_latest.api.url).toBe(ORIGIN)
})

// The capture is the shape: parameters is null (the IDE leaves the model's
// defaults alone), and the workspace fields are the collector's.
test("the body carries the capture's own values, and the workspace the collector wrote", async () => {
  ideCache(cosy, ACCOUNT())
  writeFileSync(
    join(cosy, _internal.LINGMA_CONTEXT_FILE),
    JSON.stringify({ workspaceLanguages: ["shell", "sql"], activeFilePath: "D:\work\README.md", codeLanguage: "Markdown", systemPrompt: "PROMPT FROM THE DEPLOYMENT" }),
  )
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))
  const s = store(signedIn({ lingmaRoot: cosy }))
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  expect((await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify({ ...ask, max_tokens: 384000 }) })).status).toBe(200)
  const body = JSON.parse(_internal.decodeBody(chats()[0].body))
  expect(body.parameters).toBe(null)
  expect(body.code_language).toBe("Markdown")
  expect(body.chat_context.workspaceLanguages).toEqual(["shell", "sql"])
  expect(body.chat_context.activeFilePath).toBe("D:\work\README.md")
  // the prompt the collector captured is the one the turns are given, alone:
  // the IDE sends a single system turn and the client's own prompt is dropped
  expect(body.messages[0].role).toBe("system")
  expect(body.messages[0].content).toBe("PROMPT FROM THE DEPLOYMENT")
})

test("a captured prompt replaces the client's; COSY_LINGMA_KEEP_CLIENT_PROMPT=1 appends it back", async () => {
  ideCache(cosy, ACCOUNT())
  writeFileSync(join(cosy, _internal.LINGMA_CONTEXT_FILE), JSON.stringify({ systemPrompt: "PROMPT FROM THE DEPLOYMENT" }))
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))
  const s = store(signedIn({ lingmaRoot: cosy }))
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const send = async (messages) => {
    seen = []
    await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify({ ...ask, messages }) })
    return JSON.parse(_internal.decodeBody(chats()[0].body)).messages[0].content
  }
  const withClient = [{ role: "system", content: "PI'S OWN PROMPT" }, { role: "user", content: "hi" }]
  expect(await send(withClient)).toBe("PROMPT FROM THE DEPLOYMENT")
  process.env.COSY_LINGMA_KEEP_CLIENT_PROMPT = "1"
  try {
    const kept = await send(withClient)
    expect(kept).toContain("PROMPT FROM THE DEPLOYMENT")
    expect(kept).toContain("PI'S OWN PROMPT")
  } finally {
    delete process.env.COSY_LINGMA_KEEP_CLIENT_PROMPT
  }
})

// The deployment reads an image from its own file service: the chat names a
// url that PUT /algo/api/v1... /api/v2/image/upload answered, and the envelope
// signs that upload's body by LENGTH (getAuthSignature is handed
// strconv.FormatInt(len, 10)), not by its bytes.
test("a data: image goes up before the chat and is named where the deployment reads it", async () => {
  const UPLOAD = "/algo/api/v2/image/upload"
  const FILE = "https://files.example/vl/6b9ed704.png?signature=33a6c97b"
  route = (at) => (at === HOST + CHAT ? sse(OK) : at === HOST + UPLOAD ? json({ result: { url: FILE }, success: true }) : new Response("", { status: 404 }))
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const chat = {
    model: "qmodel_latest",
    messages: [{ role: "user", content: [{ type: "text", text: "解释下图片内容" }, { type: "image_url", image_url: { url: "data:image/png;base64," + png } }] }],
  }
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(chat) })
  expect(res.status).toBe(200)

  const up = seen.find((x) => x.path === UPLOAD)
  expect(up.method).toBe("PUT")
  expect(up.search).toMatch(/^\?request_id=[0-9a-f]{32}$/)
  expect(up.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=[0-9a-f]{48}$/)
  expect(up.headers.get("accept-encoding")).toBe("identity")
  expect(up.headers.get("cosy-business-product")).toBe(null)
  expect(up.headers.get("cosy-machineid")).toBe(MACHINE)
  // the signature is over the body's length, on the api path without /algo
  const [payload, sig] = up.headers.get("authorization").replace("Bearer COSY.", "").split(".")
  const signed = createHash("md5")
    .update(`${payload}\n${up.headers.get("cosy-key")}\n${up.headers.get("cosy-date")}\n${String(up.bodyLength)}\n${UPLOAD.slice(5)}`)
    .digest("hex")
  expect(sig).toBe(signed)

  const body = JSON.parse(_internal.decodeBody(chats()[0].body))
  expect(body.image_urls).toEqual([FILE])
  expect(body.chat_context.imageUrls).toEqual([FILE])
  // the image is named in the prompt too, by the file name its upload was given
  expect(body.chat_prompt).toMatch(/#image:[0-9a-f]{8}\.png/)
  expect(body.chat_prompt).toContain("#image:")
  expect(body.chat_prompt).toContain("用户上下文:")
  expect(body.chat_prompt).toContain("解释下图片内容")
  expect(body.chat_context.chatPrompt).toBe(body.chat_prompt)
  expect(body.chat_context.text).toBe("解释下图片内容\n")
  expect(body.chat_task).toBe("FREE_INPUT")
  expect(body.agent_id).toBe("agent_chat")
})

test("an image the chat already names by url is not uploaded again, and dataUrlBytes reads what it should", async () => {
  expect(_internal.dataUrlBytes("https://files.example/a.png")).toBe(null)
  const png = _internal.dataUrlBytes("data:image/png;base64,iVBORw0KGgo=")
  expect(png.bytes.toString("base64")).toBe("iVBORw0KGgo=")
  expect(png.name).toMatch(/^[0-9a-f]{8}\.png$/)
  const text = _internal.dataUrlBytes("data:text/plain,hi")
  expect(text.bytes.toString()).toBe("hi")
  expect(text.name).toMatch(/^[0-9a-f]{8}\.plain$/)

  const FILE = "https://files.example/vl/kept.png"
  const urls = await _internal.lingmaImageUrls(
    { api: "https://" + HOST },
    { uid: "u", access: "t", machineId: MACHINE },
    { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: FILE } }] }] },
  )
  expect(urls).toEqual([FILE])
  expect(seen.length).toBe(0)
})

test("the deployment's own model list names the models its chat takes", async () => {
  const MODELS = "/algo/api/v2/model/list"
  const ORG = "org_glm-latest-coder_de64ea6840e65a7e032cb9bd383a79a3"
  route = (at) => {
    if (at === HOST + MODELS)
      return json({
        chat: [
          { key: "default", format: "dashscope", source: "system", display_name: "qwen3", is_vl: true, max_input_tokens: 96000, order: 0 },
          { key: ORG, format: "openai", source: "organization", display_name: "glm-latest-coder", is_vl: false, max_input_tokens: 96000, order: 5 },
        ],
      })
    if (at === HOST + CHAT) return sse(OK)
    return new Response("", { status: 404 })
  }
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  // a key only the domain knows is the one its chat takes, with its own format
  const one = { model: ORG, messages: [{ role: "user", content: "hi" }] }
  expect((await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(one) })).status).toBe(200)
  const body = JSON.parse(_internal.decodeBody(chats()[0].body))
  expect(body.model_config).toMatchObject({ key: ORG, format: "openai", source: "organization", display_name: "glm-latest-coder", max_input_tokens: 96000 })
  // asked as the IDE asks it, and remembered for the next turn
  const list = seen.find((x) => x.path === MODELS)
  expect(list.method).toBe("GET")
  expect(list.headers.get("accept")).toBe("application/json")
  expect(list.headers.get("cosy-business-product")).toBe(null)
  await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(one) })
  expect(seen.filter((x) => x.path === MODELS).length).toBe(1)
})

test("a deployment's reserved-looking key (default) is taken, as Qoder's own would not be", async () => {
  const MODELS = "/algo/api/v2/model/list"
  route = (at) => {
    if (at === HOST + MODELS) return json({ chat: [{ key: "default", format: "dashscope", source: "system", display_name: "qwen3", is_vl: true, max_input_tokens: 96000 }] })
    if (at === HOST + CHAT) return sse(OK)
    return new Response("", { status: 404 })
  }
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const ask = { model: "default", messages: [{ role: "user", content: "hi" }] }
  expect((await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })).status).toBe(200)
  expect(JSON.parse(_internal.decodeBody(chats()[0].body)).model_config).toMatchObject({ key: "default", format: "dashscope", source: "system" })
})

test("with no captured prompt, the chat names the IDE the collector found, and never Qoder", async () => {
  expect(_internal.lingmaUserInfo({})).toBe("")
  ideCache(cosy, ACCOUNT())
  writeFileSync(
    join(cosy, _internal.LINGMA_CONTEXT_FILE),
    JSON.stringify({ os: "windows 24H2", ide: "IntelliJ IDEA 2026.3", workspace: "D:\work\p", workspaceLanguages: ["shell", "SQL"] }),
  )
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))
  const s = store(signedIn({ lingmaRoot: cosy }))
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })
  if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`)
  const sys = JSON.parse(_internal.decodeBody(chats()[0].body)).messages[0].content
  expect(sys).toContain("Lingma")
  expect(sys).not.toContain("Qoder")
  expect(sys).toContain("<user_info>")
  expect(sys).toContain("The user's OS version is windows 24H2.  The user's IDE is IntelliJ IDEA 2026.3.")
  expect(sys).toContain("D:\work\p")
  expect(sys).toContain("shell, SQL, etc.")
})

// The deployment streams OpenAI chunks inside its envelope: content deltas,
// native tool calls (the id on the first, fragments after), a usage chunk,
// [DONE] and an event:finish tail. Every piece is read as the capture has it.
test("a Lingma stream's content, native tool calls and tail are all read", async () => {
  const chunk = (delta, finish_reason, usage) =>
    frame({ id: "chatcmpl-x", object: "chat.completion.chunk", created: 1, model: "glm-latest-coder", choices: [{ index: 0, delta, finish_reason: finish_reason ?? null }], ...(usage ? { usage } : {}) })
  const done = "data:" + JSON.stringify({ headers: { "Content-Type": ["application/json"] }, body: "[DONE]", statusCodeValue: 200, statusCode: "OK" }) + "\n\n"
  const tail = "event:finish\ndata:" + JSON.stringify({ firstTokenDuration: 948, totalDuration: 1955, serverDuration: 64 }) + "\n\n"
  const reply =
    chunk({ role: "assistant", content: "" }) +
    chunk({ content: "我来读取文件。" }) +
    chunk({ content: "", tool_calls: [{ id: "call_2b5e227f92104afabb783764", function: { arguments: '{"file', name: "read_file" }, type: "function", index: 0 }] }) +
    chunk({ content: "", tool_calls: [{ id: "", function: { arguments: '_path": "a.txt"}' }, type: "function", index: 0 }] }) +
    chunk({}, "tool_calls") +
    chunk({}, null, { completion_tokens: 7, prompt_tokens: 10, total_tokens: 17 }) +
    done +
    tail
  route = (at) => (at === HOST + CHAT ? new Response(reply, { headers: { "Content-Type": "text/event-stream" } }) : new Response("", { status: 404 }))
  const s = store(signedIn())
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const req = {
    model: "qmodel_latest",
    messages: [{ role: "user", content: "读取 a.txt" }],
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: {} } } }],
  }
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(req) })
  expect(res.status).toBe(200)
  const out = await res.json()
  expect(out.choices[0].message.content).toContain("我来读取文件")
  expect(out.choices[0].message.tool_calls?.[0]).toMatchObject({ type: "function", function: { name: "read_file", arguments: '{"file_path": "a.txt"}' } })
  // and the request named the tool as the deployment takes them
  expect(JSON.parse(_internal.decodeBody(chats()[0].body)).tools[0].function.name).toBe("read_file")
})

test("the domain field takes lingma://, which the validator must not refuse", async () => {
  const m = lingmaMethod(await QoderCNAuthPlugin({ client: store().client }))
  const field = m.prompts.find((p) => p.key === "dedicated")
  expect(field.validate(`lingma://${HOST}`)).toBeUndefined()
  expect(field.validate(`cosy://${HOST}`)).toBeUndefined()
  expect(field.validate(HOST)).toBeUndefined()
  expect(field.validate(`https://${HOST}/x`)).toBeUndefined()
  expect(String(field.validate("ftp://x"))).toContain("Not a dedicated domain")
})

test("a private deployment's token in access_token is taken when security_oauth_token is empty", async () => {
  // a real 通义灵码 cache can leave the IDE's chat token empty
  ideCache(join(sandbox, "tok"), ACCOUNT({ security_oauth_token: "", access_token: "pt-FromAccessToken" }))
  const got = await _internal.lingmaDecode(join(sandbox, "tok"))
  expect(got.access).toBe("pt-FromAccessToken")
  expect(got.uid).toBe(ACCOUNT().uid)

  // and one with neither says which fields it did have, never their values
  ideCache(join(sandbox, "none"), { uid: "u1", name: "n", some_field: "secret-value" })
  const none = await _internal.lingmaDecode(join(sandbox, "none"))
  expect(none.reason).toContain("names no signed-in account")
  expect(none.reason).toContain("security_oauth_token: no")
  expect(none.reason).toContain("some_field")
  expect(none.reason).not.toContain("secret-value")
})

// A private deployment issues no bearer token: its cache holds the account's
// RSA-wrapped key and the blob that key opens, and every call repeats that
// pair (measured: one pair across 25 requests).
test("a cache with no token signs in on its key and info pair, and repeats it", async () => {
  const KEY = "nbNZqVHezARUeuFh238l4LyYmWTwNA86EmDtSGyv" + "A".repeat(129)
  const INFO = "NhlRH3ZSVzODneWfz0d+iQW1sojTV0nt1doLW/9s" + "B".repeat(729)
  ideCache(cosy, ACCOUNT({ security_oauth_token: "", access_token: "", refresh_token: "", expire_time: 0, key: KEY, encrypt_user_info: INFO, on_premise: "true" }))
  route = (at) => (at === HOST + CHAT ? sse(OK) : new Response("", { status: 404 }))

  const hooks = await QoderCNAuthPlugin({ client: store().client })
  const cred = await (await lingmaMethod(hooks).authorize({ dedicated: HOST })).callback()
  expect(cred.lingmaKey).toBe(KEY)
  expect(cred.lingmaInfo).toBe(INFO)
  // nothing to expire, so nothing ever asks to sign in again
  expect(cred.expires).toBe(0)

  // magpie stores what the sign-in answered as the account it later loads
  const s = store({ ...cred, type: "oauth" })
  const opts = await (await QoderCNAuthPlugin({ client: s.client })).auth.loader(s.get)
  const res = await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify(ask) })
  if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`)

  // the pair the cache held is the pair the call carried
  const h = chats()[0].headers
  expect(h.get("cosy-key")).toBe(KEY)
  const payload = JSON.parse(Buffer.from(h.get("authorization").replace("Bearer COSY.", "").split(".")[0], "base64").toString("utf8"))
  expect(payload.info).toBe(INFO)
})

// The IDE's own list names a context window and nothing else: its requests
// carry parameters: null, so the deployment's own default is the output
// ceiling. The plugin must not invent either.
test("a model's window is the deployment's, and its output ceiling is left to the deployment", async () => {
  const ORG = "org_glm-latest-coder_de64ea6840e65a7e032cb9bd383a79a3"
  route = (at) => {
    if (at === HOST + _internal.LINGMA_MODELS_PATH)
      return json({ chat: [
        { key: ORG, format: "openai", source: "organization", display_name: "glm-latest-coder", is_vl: false, max_input_tokens: 96000, enable: true },
        { key: "with-ceiling", format: "openai", source: "organization", display_name: "ceiling", max_input_tokens: 32000, max_output_tokens: 8192, enable: true },
      ] })
    if (at === HOST + CHAT) return sse(OK)
    return new Response("", { status: 404 })
  }
  const s = store(signedIn())
  const hooks = await QoderCNAuthPlugin({ client: s.client })
  const ms = await hooks.provider.models({ models: {} }, { auth: s.auth() })
  // the window the deployment named
  expect(ms[ORG].limit).toEqual({ context: 96000, output: 0 })
  // and a ceiling it did name is taken
  expect(ms["with-ceiling"].limit).toEqual({ context: 32000, output: 8192 })

  // what is sent keeps the IDE's own: no max_tokens of our own
  const opts = await hooks.auth.loader(s.get)
  await opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", body: JSON.stringify({ ...ask, model: ORG, max_tokens: 384000 }) })
  expect(JSON.parse(_internal.decodeBody(chats()[0].body)).parameters).toBe(null)
})
