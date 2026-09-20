// 共享加密工具：PIN 哈希、token 生成（沿用 shop-booking 方案）

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return uint8ToHex(new Uint8Array(sig));
}

// 恒定时间比较，避免时序侧信道
export async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  if (!expectedHash || actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

export function genToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

export function genSalt(bytes = 16) {
  return genToken(bytes);
}

function uint8ToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
