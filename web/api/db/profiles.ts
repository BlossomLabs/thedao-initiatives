import { K } from "./keys.ts";
import type { Profile } from "./types.ts";

export function profilesRepo(kv: Deno.Kv, now: () => number) {
  async function get(address: string): Promise<Profile> {
    return (await kv.get<Profile>(K.profile(address))).value ??
      { nickname: "", pfp: "", updatedAt: 0 };
  }
  const nicknameOwner = async (nick: string) => (await kv.get<string>(K.nick(nick))).value;

  /** Claim a nickname for an address. false = taken by someone else. */
  async function setNickname(address: string, nickname: string): Promise<boolean> {
    const low = address.toLowerCase();
    const cur = await kv.get<Profile>(K.profile(address));
    const idx = await kv.get<string>(K.nick(nickname));
    if (idx.value && idx.value !== low) return false;
    const op = kv.atomic().check(cur).check(idx)
      .set(K.profile(address), { ...(await get(address)), nickname, updatedAt: now() })
      .set(K.nick(nickname), low);
    if (
      cur.value?.nickname && cur.value.nickname.toLowerCase() !== nickname.toLowerCase()
    ) {
      op.delete(K.nick(cur.value.nickname));
    }
    return (await op.commit()).ok;
  }

  async function setPfp(address: string, pfp: string): Promise<void> {
    await kv.set(K.profile(address), { ...(await get(address)), pfp, updatedAt: now() });
  }
  return { get, nicknameOwner, setNickname, setPfp };
}
