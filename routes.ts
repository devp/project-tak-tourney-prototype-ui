import { Router } from "jsr:@oak/oak/router";
import type { RouterContext } from "jsr:@oak/oak/router";
import { Eta } from "https://deno.land/x/eta@v3.1.0/src/index.ts";
import { analyzeTournamentProgress } from "https://raw.githubusercontent.com/devp/project-tak-tourney-adhoc/refs/heads/main/src/tournament-analyzer.ts";
import {
  isTournamentInfoFromJson,
  isTournamentStatus,
} from "https://raw.githubusercontent.com/devp/project-tak-tourney-adhoc/refs/heads/main/src/types.guard.ts";
import { isGameListResponse } from "https://raw.githubusercontent.com/devp/project-tak-tourney-adhoc/refs/heads/main/src/playtak-api/types.guard.ts";
import { API_URL, KNOWN_TOURNAMENTS } from "./data/data.ts";
import type {
  TournamentInfo,
  TournamentPlayer,
  TournamentStatus,
} from "https://raw.githubusercontent.com/devp/project-tak-tourney-adhoc/refs/heads/main/src/types.ts";
import { ApiResponseCache, GeneratedTournamentStatusCache } from "./cache.ts";

export const router = new Router();

const eta = new Eta({ views: "./templates" });

function makeRenderer(templateName: string, templateOptions = {}) {
  return (ctx: RouterContext<string>) => {
    ctx.response.body = eta.render(templateName, templateOptions);
  };
}

router.get("/", (ctx) => {
  ctx.response.redirect("/tournaments");
});

router.get("/tournaments", (ctx: RouterContext<string>) => {
  return (makeRenderer("./tournaments", {
    tournaments: Object.keys(KNOWN_TOURNAMENTS),
  }))(ctx);
});

function parsePlayersCsv(playersCsv: string) {
  const rows: [string, string][] = playersCsv.trim().split("\n").slice(1).map(
    (line) => line.trim().split(","),
  ).filter(Boolean).map(
    (parts) => [parts[0], parts[1]] as [string, string],
  );
  return rows.map(([username, group]) => ({ username, group }));
}

async function fetchGamesResponse(url: string) {
  const cachedResponse = ApiResponseCache.get(url);
  if (cachedResponse && isGameListResponse(cachedResponse)) {
    return cachedResponse;
  }
  const response = await (await fetch(url)).json();
  if (!isGameListResponse(response)) {
    return null;
  }
  ApiResponseCache.set(url, response);
  return response;
}

async function getTournamentData(id: string) {
  const tournamentData =
    KNOWN_TOURNAMENTS[id as keyof typeof KNOWN_TOURNAMENTS] ?? null;
  if (tournamentData === null) {
    return { error: 404 };
  }

  const tournamentInfoFromJson = JSON.parse(
    await Deno.readTextFile(tournamentData.infoPath),
  );
  if (!isTournamentInfoFromJson(tournamentInfoFromJson)) {
    return { error: 400 };
  }

  const tournamentInfo: TournamentInfo = {
    ...tournamentInfoFromJson,
    dateRange: {
      start: new Date(tournamentInfoFromJson.dateRange.start),
      end: new Date(tournamentInfoFromJson.dateRange.end),
    },
  };

  let status: TournamentStatus | undefined;
  if (tournamentData.playersCsvUrl) {
    const cachedStatus = GeneratedTournamentStatusCache.get(id);
    if (cachedStatus && isTournamentStatus(cachedStatus)) {
      status = cachedStatus;
    } else {
      const gamesResponse = await fetchGamesResponse(API_URL);
      if (gamesResponse === null) {
        return { error: 400 };
      }
      const games = gamesResponse.items;

      const playersCsv = await (await fetch(tournamentData.playersCsvUrl))
        .text();
      const players: TournamentPlayer[] = parsePlayersCsv(playersCsv);
      tournamentInfo.players = players;

      status = analyzeTournamentProgress({
        tournamentInfo,
        games,
      });

      GeneratedTournamentStatusCache.set(id, status);
    }
  }

  return { tournamentInfo, status, error: null };
}

router.get("/tournaments/:id", async (ctx: RouterContext<string>) => {
  const { tournamentInfo, status, error } = await getTournamentData(ctx.params.id);
  if (!tournamentInfo) {
    return ctx.response.status = 404;
  }
  if (error) {
    return ctx.response.status = error;
  }

  const groupStatus = (status?.tournamentType === "groupStage")
    ? {
      groups: status.groups.map((group) => ({
        name: group.name,
        players: status.players.filter((player) => player.group === group.name),
        winner: group.winner,
        winner_method: group.winner_method,
      })),
    }
    : null;

  return (makeRenderer("./tournament", {
    tournament: {
      name: tournamentInfo.name,
      infoUrl: tournamentInfo.infoUrl,
    },
    groupStatus,
  }))(ctx);
});

router.get("/tournaments/:id/:groupIndex", async (ctx: RouterContext<string>) => {
  const id = ctx.params.id;
  const groupIndex = ctx.params.groupIndex;
});

