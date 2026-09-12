import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * Upstage Solar — OpenAI 호환 엔드포인트.
 *
 * 환경변수는 모듈 로드 시점이 아니라 **호출 시점**에 읽는다.
 * ESM은 import를 먼저 전부 평가하므로, 모듈 최상단에서 process.env를 읽으면
 * dotenv나 러너의 env 주입보다 먼저 실행되어 빈 키로 클라이언트가 만들어진다.
 * (실제로 이 버그를 겪었다: 키는 멀쩡한데 "API key is invalid"가 났다.)
 */

export function solarModelName(): string {
  return process.env.SOLAR_MODEL ?? "solar-pro2";
}

let cached: { key: string; base: string; name: string; model: LanguageModel } | null = null;

export function getSolar(): LanguageModel {
  const key = process.env.UPSTAGE_API_KEY ?? "";
  const base = process.env.UPSTAGE_BASE_URL ?? "https://api.upstage.ai/v1";
  const name = solarModelName();

  if (!key) {
    throw new Error(
      "UPSTAGE_API_KEY가 설정되지 않았습니다. hwpx-app/.env.local 에 키를 넣어주세요.",
    );
  }

  if (cached && cached.key === key && cached.base === base && cached.name === name) {
    return cached.model;
  }

  const upstage = createOpenAICompatible({
    name: "upstage",
    baseURL: base,
    apiKey: key,
    // Solar는 response_format: json_schema를 지원한다 (실측 확인).
    // 이걸 켜지 않으면 SDK가 json_object 모드로 보내고, Upstage는 그 모드에서
    // "메시지에 'json'이라는 단어가 있어야 한다"며 거부한다.
    supportsStructuredOutputs: true,
  });
  const model = upstage(name);
  cached = { key, base, name, model };
  return model;
}

export function assertSolarConfigured(): void {
  getSolar();
}
