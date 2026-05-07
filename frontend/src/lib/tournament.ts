export interface TournamentPlayer {
  id: string;
  name: string;
  isHuman?: boolean;
  dropped?: boolean;
}

export interface TournamentMatch {
  id: string;
  round: number;
  table: number;
  player1Id: string;
  player2Id?: string;
  playDrawChooserId?: string;
  isBye?: boolean;
  reported?: boolean;
  gameWins: Record<string, number>;
  gameDraws: number;
  matchDraw?: boolean;
  winnerId?: string;
}

export interface Standing {
  rank: number;
  player: TournamentPlayer;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  matchPoints: number;
  gameWins: number;
  gameLosses: number;
  gameDraws: number;
  gamePoints: number;
  matchesPlayed: number;
  gamesPlayed: number;
  opponents: string[];
  mwp: number;
  gwp: number;
  omwp: number;
  ogwp: number;
}

interface MutableStanding extends Omit<Standing, 'rank' | 'mwp' | 'gwp' | 'omwp' | 'ogwp'> {
  mwp: number;
  gwp: number;
  omwp: number;
  ogwp: number;
}

export function recommendedSwissRounds(playerCount: number): number {
  if (playerCount <= 8) return 3;
  if (playerCount <= 16) return 4;
  if (playerCount <= 32) return 5;
  if (playerCount <= 64) return 6;
  return 7;
}

export function createTournamentPlayers(playerCount: number): TournamentPlayer[] {
  return Array.from({ length: playerCount }, (_, index) => ({
    id: index === 0 ? 'human' : `ai-${index}`,
    name: index === 0 ? 'You' : `AI Player ${index}`,
    isHuman: index === 0,
  }));
}

function percentage(points: number, possible: number): number {
  if (possible <= 0) return 0.33;
  return Math.max(0.33, points / possible);
}

function hasPlayed(matches: TournamentMatch[], playerA: string, playerB: string): boolean {
  return matches.some(match => {
    if (!match.player2Id) return false;
    return (
      (match.player1Id === playerA && match.player2Id === playerB) ||
      (match.player1Id === playerB && match.player2Id === playerA)
    );
  });
}

function shufflePlayers(players: TournamentPlayer[]): TournamentPlayer[] {
  const result = [...players];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function calculateStandings(players: TournamentPlayer[], matches: TournamentMatch[]): Standing[] {
  const records = new Map<string, MutableStanding>();

  for (const player of players) {
    records.set(player.id, {
      player,
      matchWins: 0,
      matchLosses: 0,
      matchDraws: 0,
      matchPoints: 0,
      gameWins: 0,
      gameLosses: 0,
      gameDraws: 0,
      gamePoints: 0,
      matchesPlayed: 0,
      gamesPlayed: 0,
      opponents: [],
      mwp: 0.33,
      gwp: 0.33,
      omwp: 0.33,
      ogwp: 0.33,
    });
  }

  for (const match of matches.filter(match => match.reported)) {
    const p1 = records.get(match.player1Id);
    if (!p1) continue;

    if (match.isBye || !match.player2Id) {
      p1.matchWins += 1;
      p1.matchPoints += 3;
      p1.matchesPlayed += 1;
      p1.gameWins += 2;
      p1.gamePoints += 6;
      p1.gamesPlayed += 2;
      continue;
    }

    const p2 = records.get(match.player2Id);
    if (!p2) continue;

    const p1Wins = match.gameWins[match.player1Id] || 0;
    const p2Wins = match.gameWins[match.player2Id] || 0;
    const gameDraws = match.gameDraws || 0;
    const gamesPlayed = p1Wins + p2Wins + gameDraws;

    p1.matchesPlayed += 1;
    p2.matchesPlayed += 1;
    p1.opponents.push(match.player2Id);
    p2.opponents.push(match.player1Id);

    p1.gameWins += p1Wins;
    p1.gameLosses += p2Wins;
    p1.gameDraws += gameDraws;
    p1.gamePoints += p1Wins * 3 + gameDraws;
    p1.gamesPlayed += gamesPlayed;

    p2.gameWins += p2Wins;
    p2.gameLosses += p1Wins;
    p2.gameDraws += gameDraws;
    p2.gamePoints += p2Wins * 3 + gameDraws;
    p2.gamesPlayed += gamesPlayed;

    if (match.matchDraw || p1Wins === p2Wins) {
      p1.matchDraws += 1;
      p2.matchDraws += 1;
      p1.matchPoints += 1;
      p2.matchPoints += 1;
    } else if (p1Wins > p2Wins) {
      p1.matchWins += 1;
      p2.matchLosses += 1;
      p1.matchPoints += 3;
    } else {
      p2.matchWins += 1;
      p1.matchLosses += 1;
      p2.matchPoints += 3;
    }
  }

  for (const record of records.values()) {
    record.mwp = percentage(record.matchPoints, record.matchesPlayed * 3);
    record.gwp = percentage(record.gamePoints, record.gamesPlayed * 3);
  }

  for (const record of records.values()) {
    const opponents = record.opponents
      .map(id => records.get(id))
      .filter((opponent): opponent is MutableStanding => Boolean(opponent));
    if (opponents.length > 0) {
      record.omwp = opponents.reduce((sum, opponent) => sum + opponent.mwp, 0) / opponents.length;
      record.ogwp = opponents.reduce((sum, opponent) => sum + opponent.gwp, 0) / opponents.length;
    }
  }

  return [...records.values()]
    .sort((a, b) => {
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
      if (b.omwp !== a.omwp) return b.omwp - a.omwp;
      if (b.gwp !== a.gwp) return b.gwp - a.gwp;
      if (b.ogwp !== a.ogwp) return b.ogwp - a.ogwp;
      return a.player.name.localeCompare(b.player.name);
    })
    .map((standing, index) => ({ ...standing, rank: index + 1 }));
}

function selectByePlayer(players: TournamentPlayer[], standings: Standing[], matches: TournamentMatch[]): TournamentPlayer {
  const previousByes = new Set(matches.filter(match => match.isBye).map(match => match.player1Id));
  const rankedLowToHigh = [...standings]
    .map(standing => standing.player)
    .filter(player => players.some(active => active.id === player.id))
    .reverse();
  return rankedLowToHigh.find(player => !previousByes.has(player.id)) || rankedLowToHigh[0];
}

export function pairSwissRound(
  players: TournamentPlayer[],
  previousMatches: TournamentMatch[],
  round: number,
): TournamentMatch[] {
  const activePlayers = players.filter(player => !player.dropped);
  const standings = calculateStandings(players, previousMatches);
  const ordered = round === 1 && previousMatches.length === 0
    ? shufflePlayers(activePlayers)
    : standings
      .map(standing => standing.player)
      .filter(player => activePlayers.some(active => active.id === player.id));

  const pairable = [...ordered];
  const matches: TournamentMatch[] = [];

  if (pairable.length % 2 === 1) {
    const byePlayer = selectByePlayer(pairable, standings, previousMatches);
    const index = pairable.findIndex(player => player.id === byePlayer.id);
    if (index >= 0) pairable.splice(index, 1);
    matches.push({
      id: `r${round}-bye-${byePlayer.id}`,
      round,
      table: Math.ceil(activePlayers.length / 2),
      player1Id: byePlayer.id,
      isBye: true,
      reported: true,
      gameWins: { [byePlayer.id]: 2 },
      gameDraws: 0,
      winnerId: byePlayer.id,
    });
  }

  let table = 1;
  while (pairable.length > 0) {
    const player1 = pairable.shift()!;
    let opponentIndex = pairable.findIndex(player => !hasPlayed(previousMatches, player1.id, player.id));
    if (opponentIndex < 0) opponentIndex = 0;
    const player2 = pairable.splice(opponentIndex, 1)[0];
    const playDrawChooserId = Math.random() < 0.5 ? player1.id : player2.id;

    matches.push({
      id: `r${round}-t${table}-${player1.id}-${player2.id}`,
      round,
      table,
      player1Id: player1.id,
      player2Id: player2.id,
      playDrawChooserId,
      reported: false,
      gameWins: { [player1.id]: 0, [player2.id]: 0 },
      gameDraws: 0,
    });
    table += 1;
  }

  return matches.sort((a, b) => a.table - b.table);
}

export function reportMatch(
  match: TournamentMatch,
  player1Wins: number,
  player2Wins: number,
  gameDraws = 0,
): TournamentMatch {
  if (!match.player2Id) return match;
  const matchDraw = player1Wins === player2Wins;
  const winnerId = matchDraw
    ? undefined
    : player1Wins > player2Wins
      ? match.player1Id
      : match.player2Id;
  return {
    ...match,
    reported: true,
    gameWins: {
      [match.player1Id]: player1Wins,
      [match.player2Id]: player2Wins,
    },
    gameDraws,
    matchDraw,
    winnerId,
  };
}

export function formatPct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
