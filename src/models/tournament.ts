import { DEFAULT_KNOWN_TOURNAMENTS } from "../../data/data.ts";
import { TournamentStatusTypeGuards } from "@tak-tourney-adhoc";
import type { TournamentStatusTypes } from "@tak-tourney-adhoc";

const { isTournamentInfo } = TournamentStatusTypeGuards;

type TournamentInfo = TournamentStatusTypes.TournamentInfo;
type TournamentPlayer = TournamentStatusTypes.TournamentPlayer;

const KEY = ["tournament-info"];

const keyOfId = (id: string) => [...KEY, id];

function parsePlayersCsv(playersCsv: string) {
  const rows: [string, string][] = playersCsv.trim().split("\n").map(
    (line) => line.trim().split(","),
  ).filter(Boolean).map(
    (parts) => [parts[0].trim(), parts[1].trim()] as [string, string],
  );
  return rows.map(([username, group]) => ({ username, group }));
}

export class Tournament {
  kv?: Deno.Kv;
  id: string;
  info?: TournamentInfo;

  constructor(id: string, kv?: Deno.Kv) {
    this.kv = kv;
    this.id = id;
  }

  async load(): Promise<boolean> {
    try {
      if (await this.loadInfoFromKv()) {
        return true;
      }
      if (await this.loadInfoFromDefaultData()) {
        return true;
      }
    } catch (e) {
      console.error((e as Error).toString());
    }
    return false;
  }

  static async load(id: string, kv?: Deno.Kv) {
    const tournament = new Tournament(id, kv);
    await tournament.load();
    return tournament;
  }

  static async save(id: string, data: unknown, kv: Deno.Kv): Promise<boolean> {
    if (!isTournamentInfo(data)) {
      console.error("Invalid tournament info");
      return false;
    }
    await kv.set(keyOfId(id), data);
    return true;
  }

  async loadInfoFromKv() {
    if (!this.kv) {
      return false;
    }

    const result = await this.kv.get(keyOfId(this.id));
    if (!result.value) {
      return false;
    }

    if (!isTournamentInfo(result.value)) {
      throw new Error(`Tournament info found in KV for ${this.id} but invalid`);
    }

    this.info = result.value;
    return true;
  }

  async loadInfoFromDefaultData() {
    const tournamentData = DEFAULT_KNOWN_TOURNAMENTS[
      this.id as keyof typeof DEFAULT_KNOWN_TOURNAMENTS
    ] ?? null;
    if (tournamentData === null) {
      return false;
    }

    const tournamentInfo = JSON.parse(
      await Deno.readTextFile(tournamentData.infoPath),
    );
    if (!isTournamentInfo(tournamentInfo)) {
      throw new Error(
        `Tournament info read from ${tournamentData.infoPath} but invalid`,
      );
    }

    // Change from previous implementation: only load players if empty
    if (tournamentInfo.players.length === 0 && tournamentData.playersCsvUrl) {
      const playersCsv = await (await fetch(tournamentData.playersCsvUrl))
        .text();
      const players: TournamentPlayer[] = parsePlayersCsv(playersCsv);
      tournamentInfo.players = players;
    }

    this.info = tournamentInfo;
    return true;
  }

  static async listAllIds(kv: Deno.Kv): Promise<string[]> {
    const defaultIds = Object.keys(DEFAULT_KNOWN_TOURNAMENTS);

    const kvIds = new Set<string>();
    for await (const entry of kv.list({ prefix: KEY })) {
      const id = entry.key[1] as string;
      kvIds.add(id);
    }

    // Combine and deduplicate IDs
    return [...new Set([...defaultIds, ...kvIds])];
  }
}
