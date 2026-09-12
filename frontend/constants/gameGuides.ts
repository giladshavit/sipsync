// Long-form guide text for the public rule pages (/games/<id>). The rule
// card in constants/games.ts is deliberately terse because it doubles as
// the in-room tutorial; this file carries the prose a person reads before
// game night: how the game actually plays at the table, what to do about
// it, and how to bend it. Rendered statically by app/games/[id]/index.tsx
// so crawlers see it (#179). Written per game, not templated.

export interface GameGuide {
  /** What the round feels like once real people are playing it. */
  overview: string;
  /** Concrete advice, one tip per entry. */
  strategy: string[];
  /** House rules the table can agree on out loud before the round. */
  variations: string[];
  /** How the game holds up when the cup has water in it. */
  withoutAlcohol: string;
}

export const GAME_GUIDES: Record<string, GameGuide> = {
  reflex: {
    overview:
      'Green Light is the purest reflex test in Quickle and usually the first game a new room plays. Everyone stares at the same red screen on their own phone, the wait stretches just long enough to get uncomfortable, and then it flips. The whole round is over in under a second, which is exactly why it works: there is no time to think, only to react. The server timestamps every tap, so the person on hotel Wi-Fi is judged on the same clock as the person standing next to the router.',
    strategy: [
      'Do not try to predict the flip. The red phase lasts a random amount of time, and tapping early costs you the same as being slowest, plus a drink. Patience is the whole skill.',
      'Rest your thumb a few millimetres above the screen rather than on it. Touching the glass early registers as a tap during the red light.',
      'Keep your eyes on your own phone. Reacting to someone else flinching adds their reaction time to yours.',
      'Silence the table for the countdown. A shout of "now!" from a joker is the oldest trick in the game and it still works on somebody every night.',
    ],
    variations: [
      'Bottom two: the two slowest players drink instead of one. Good for big rooms where a single loser barely dents the group.',
      'Champion\'s call: the fastest player picks one extra person to drink, no reason required.',
      'Blind round: phones face down until the host says go, then everyone flips their phone over and plays. Adds a second reflex to the first.',
    ],
    withoutAlcohol:
      'Green Light needs nothing in the cup to be fun; the tension is in the wait, not the penalty. Play it for points alone, or swap the drink for a dare, a push-up, or the honour of fetching the next round of snacks.',
  },
  tap_race: {
    overview:
      'Tap Race is ten seconds of pure noise. The window opens, every thumb in the room goes to work, and the phone counts. There is no bluffing and no luck in it, which makes it a great palate cleanser between the sneakier strategy games. Rooms tend to get louder each time it comes around, because everyone has a technique they are convinced is faster than everyone else\'s.',
    strategy: [
      'Alternate two fingers on the same spot instead of hammering with one thumb. Most people roughly double their count the first time they try it.',
      'Put the phone flat on the table. A phone held in one hand moves with every tap, and the movement eats your rhythm.',
      'Start the instant the window opens and do not look up to check on anyone. Ten seconds is shorter than it sounds, and a glance costs you a dozen taps.',
      'Do not tense up. A relaxed wrist keeps a steady pace for the full ten seconds; a clenched one fades after five.',
    ],
    variations: [
      'Off hand: everyone taps with their non-dominant hand. Levels the field between the seasoned gamers and everyone else.',
      'One finger only: the two-finger technique is banned, and the host is the referee.',
      'Team relay: split the room into pairs and add both scores. The weaker tapper in each pair suddenly matters a lot.',
    ],
    withoutAlcohol:
      'Tap Race is a fitness test for thumbs and works exactly the same with lemonade. The score on screen is the real prize, and a room that plays it sober often ends up chasing personal records instead of chasers.',
  },
  human_timer: {
    overview:
      'Human Timer removes the clock and asks you to be one. A target appears, say 7 seconds, and every player taps when they believe that much time has passed. Nothing on screen helps you; it is your internal sense of time against everyone else\'s. Rooms discover quickly that most people run fast when they are excited, which is most of the time at a party, and that the person who sits still and breathes usually wins.',
    strategy: [
      'Count with a fixed phrase, one-Mississippi style, and use the same phrase every round. Consistency beats accuracy; you can only calibrate a method you repeat.',
      'Slow down deliberately. Excitement compresses your sense of time, so if you feel like it is time to tap, wait one more beat.',
      'Ignore everyone else\'s taps. Hearing others go early pulls you early, and the ones who tap first are rarely the ones who were closest.',
      'Always tap. Missing the window entirely is scored as the worst result, so a rough guess is always better than no guess.',
    ],
    variations: [
      'Eyes closed: everyone shuts their eyes on go and opens them after they tap. Removes the temptation to watch the room.',
      'Long count: the host announces the round as a long one and the table agrees that the two farthest off both drink.',
      'Shared penalty: the farthest player names someone else who drinks with them, so the loser is never alone.',
    ],
    withoutAlcohol:
      'Human Timer is a concentration game before it is a drinking game. Play it for points, or have the loser take on a small forfeit, and it stays exactly as tense with a glass of water in hand.',
  },
  roulette: {
    overview:
      'Russian Roulette is the game the room goes quiet for. Six face-down cards, one of them poison, and the turn passes around the table until somebody finds it. Every safe flip shortens the odds for the next player, so the tension climbs with each card. You get one skip for the whole game, and knowing when to burn it is the entire strategy. The poison costs three chasers and 15 points, which makes this the swingiest round in Quickle.',
    strategy: [
      'Flip early, skip late. With six or five cards closed the poison is a one-in-six or one-in-five shot, far better than the guaranteed chaser a skip costs you. With three or fewer cards left, the odds flip and the skip becomes the smart buy.',
      'The points reward bravery. A safe flip is worth 3 points with six cards closed and 7 with only two, so the later you flip safely, the more you earn.',
      'Count the closed cards before your turn, not during it. Deciding under the table\'s stare is how people skip at the wrong moment.',
      'Never skip twice in your head. You only have one, and a room will happily remind you that you already used it.',
    ],
    variations: [
      'No skips: the table agrees to remove the skip entirely. Faster, crueller, and the odds do all the talking.',
      'Dealer\'s choice: the player who found the poison picks who flips first next time it comes around.',
      'Shared poison: the person who flips the poison and the person who flipped right before them both drink, one chaser each.',
    ],
    withoutAlcohol:
      'The dread of the last two cards is the fun of Roulette, and the dread does not care what is in the cup. Play for points, or make the poison card a dare card, and the room will still hold its breath for the flip.',
  },
  coin_flip: {
    overview:
      'Liar\'s Coin is a bluffing game hiding inside a coin toss. One player flips, sees the result, and announces it, truthfully or not. Everyone else has to decide whether to believe them. Wrong guesses drink, but if more than half the room reads the flipper correctly, the flipper drinks double. The coin is irrelevant within a round or two; what the room is really playing is the person holding it.',
    strategy: [
      'As the flipper, tell the truth more often than you think you should. Most rooms assume a lie, so an honest call is the more surprising play.',
      'As a guesser, forget the coin and read the person. Do they always lie, do they get shifty when honest, did they hesitate before announcing?',
      'Watch the room, not just the flipper. If the majority is clearly going one way and you agree with them, the flipper is about to drink double, which is worth more than your own safety.',
      'Always vote. Sitting out counts as a wrong guess, so an uncertain pick still beats no pick.',
    ],
    variations: [
      'Poker face: the flipper announces with no words, only by holding up a thumb up for heads or down for tails, and may not speak until the votes are in.',
      'Rematch: whoever called the flipper correctly in the biggest majority gets to be the next flipper.',
      'Double stakes: the table agrees that wrong guesses drink two on rounds where the flipper is caught lying.',
    ],
    withoutAlcohol:
      'Liar\'s Coin is a lie-detector party game that happens to have a drink attached. The points already punish bad reads and reward good ones, so it plays at full strength with nothing stronger than a soda.',
  },
  closest_average: {
    overview:
      'Closest Average is a mind game with numbers. Everyone secretly picks anything from 0 to 99, the room\'s average is calculated, and the person farthest from it drinks. There is no right number, only a right guess about how everyone else is thinking. Rooms that play it a few times develop a shared instinct for where the average lands, and then someone deliberately breaks it, and the whole thing resets.',
    strategy: [
      'Fifty is the anchor, not the answer. A room full of people who all pick 50 produces an average of 50, so the game is really about who drifts, and by how much.',
      'Extreme numbers are almost always the loser. Picking 3 or 97 only pays off if the room is wildly split, and it usually is not.',
      'Think about the outliers. One person picking 99 drags the average up by several points in a small room, so if you know the table has a joker, lean a little high.',
      'This game needs at least three players, because with two you are both the average and neither of you can be farther from it than the other.',
    ],
    variations: [
      'Two-thirds rule: announce before the round that the target is two-thirds of the average instead of the average itself. It rewards players who think one step further than the table.',
      'Banned zone: the table agrees that 40 to 60 is off limits, which forces everyone to commit to a side.',
      'Say it out loud: after the reveal, each player explains their pick. Nobody drinks more, but the next round gets much sharper.',
    ],
    withoutAlcohol:
      'Closest Average is a guessing game about people, and the reveal is the payoff. It plays exactly the same for points only, and it is a good one for a mixed table where some players are drinking and some are driving.',
  },
  sacrifice: {
    overview:
      'The Sacrifice puts a bill in front of the room and asks who is paying. A target number of chasers appears, a 30-second clock starts, and anyone can tap to take one of them. If the room covers the target in time, only the volunteers drink what they pledged. If the room comes up short, everyone drinks, and the volunteers drink their pledge on top. It is a game about the bystander effect, and it exposes who steps up and who waits for someone else to.',
    strategy: [
      'Pledge early if you are going to pledge at all. The points for a saved room, 10 per chaser, are the biggest reward in the game, and an early tap encourages the rest of the table to follow.',
      'Know the room. A table that always saves itself is a table where volunteering is nearly free; a table that lets the clock run is a table where a pledge costs you twice.',
      'Watch the target, not the timer. Once the number is down to one or two, the last pledge is a bargain, because it guarantees the room is safe.',
      'Never volunteer out of spite in the last second unless the target is actually reachable. A pledge that still leaves the room short is the worst outcome available.',
    ],
    variations: [
      'Named sacrifice: before tapping, a volunteer announces which specific drink they are taking on, and the table holds them to it.',
      'Captain\'s call: one player each round is captain and must pledge at least one chaser, then persuade the rest of the room to cover the remainder.',
      'Silent clock: no talking during the 30 seconds. Volunteering becomes a decision rather than a negotiation.',
    ],
    withoutAlcohol:
      'The Sacrifice works whenever the pledge costs something, and the cost does not have to be alcohol. Pledge sips of water, pledge push-ups, or play it purely for the points, which already swing further here than in any other round.',
  },
  dilemma: {
    overview:
      'Prisoner\'s Dilemma is the oldest question in game theory with a drink attached. The room is split into random pairs, and each half of a pair secretly chooses to Help or Betray. Mutual help is a small win for both. A betrayal against a helper is a big win for the traitor and a painful loss for the victim. Mutual betrayal hurts both, but less than being the only one who trusted. Over a whole night the pairs shuffle, reputations form, and the room starts to remember who did what.',
    strategy: [
      'Read the grid before you decide. Betraying a helper earns you 10 points and no drink; helping a betrayer costs you 10 points and two chasers. The gap between those two outcomes is the whole tension.',
      'Reputation matters because the game repeats. A player known for betraying gets betrayed back, and mutual betrayal is a loss for both, so a clean record is worth something later in the night.',
      'Promises across the table are not binding, and everyone knows it. Treat a loud declaration of loyalty as information about the person, not about their choice.',
      'If the room has an odd number of players, one person sits the round out and is immune. Check whether that is you before spending any energy on the decision.',
    ],
    variations: [
      'Public verdict: each player announces their intention out loud before choosing in secret. Lying is allowed, which is the point.',
      'Grudge match: any pair that was matched in a previous round and betrayed each other must be re-paired at the next opportunity.',
      'Truce round: the table can agree that a single round is played with helping only, as a reset after a run of betrayals.',
    ],
    withoutAlcohol:
      'The Dilemma is the most interesting game in Quickle to play sober, because the drinks were never the point. The scores swing hardest here, and the stories the room tells about who betrayed whom last longer than any hangover.',
  },
  majority: {
    overview:
      'Go with the Flow is a crowd-reading game. A question with two answers appears, everyone picks one, and the goal is simple: be on the bigger side. Anyone on the smaller side drinks. It sounds trivial until you notice that the question is not asking what you think, it is asking what you think everyone else thinks. A room full of people trying to predict each other is a room that surprises itself constantly.',
    strategy: [
      'Answer for the room, not for yourself. Your own opinion is one vote; the majority is decided by everybody else.',
      'The loudest person at the table is not the majority. A confident shout of "obviously pizza" tells you where one vote is going and nothing more.',
      'Ties are settled by a coin flip and the losing side drinks, so in small rooms a tie is a real risk. With an even number of players, lean towards the option you think has the slight edge rather than the one you prefer.',
      'Watch how earlier questions went. Rooms have a house style, and after two or three rounds you can usually feel which way a new question will fall.',
    ],
    variations: [
      'Explain yourself: after the reveal, everyone in the minority explains their reasoning. No extra drinks, but plenty of arguments.',
      'Silent vote: nobody may speak between the question appearing and the reveal. Removes the loud voter problem entirely.',
      'Lone wolf bonus: if exactly one person is in the minority, the table agrees they drink two, because they clearly were not paying attention.',
    ],
    withoutAlcohol:
      'Go with the Flow is a conversation starter first. The questions get the room talking, the reveal gets it laughing, and the points keep score fine on their own. It is one of the best games in Quickle for a mixed room with non-drinkers.',
  },
  minority: {
    overview:
      'Against the Flow takes Go with the Flow and turns it inside out. Same setup, a question with two answers, but now you win by being on the smaller side, and the crowd drinks. It sounds like the same game in reverse, and it is not: when everyone tries to be contrarian, the contrarian answer becomes the popular one, and the room ties itself in knots trying to think one level deeper than everyone else.',
    strategy: [
      'Assume everyone else is also trying to be in the minority. The obvious unpopular answer is often where the whole room ends up, which makes it the majority.',
      'The safest play is usually the honest one. When the table is busy out-thinking itself, the person who just answers the question truthfully lands on the small side surprisingly often.',
      'Ties go to a coin flip and the losing side drinks. In a room of four or six, a split is likely, so do not celebrate until the coin has landed.',
      'Do not over-think a question with a genuinely lopsided answer. If nine out of ten people really would pick one option, the minority is right there and it is not clever to avoid it.',
    ],
    variations: [
      'Mixed mode: the host alternates Go with the Flow and Against the Flow without announcing which is which until the reveal. Chaos, in a good way.',
      'Show your work: minority winners explain what they expected the room to do. It teaches the table how each player thinks, which makes the next round harder.',
      'Lone wolf: if exactly one player lands in the minority, they pick one extra person from the majority to drink.',
    ],
    withoutAlcohol:
      'Against the Flow is a pure prediction game. The scoring already rewards the good reads, so it plays at full strength for points, and it is great for a room where the drinkers and the drivers want to play the same game together.',
  },
  strong_point: {
    overview:
      'Strong Point is a reflex game with a target. A random spot on your screen begins to grow into a circle, slowly, and you have to tap inside it as fast as you can. The slowest hit drinks, and so does anyone who tapped outside the circle or did not tap at all. It is the aiming cousin of Green Light: the same twitch, but now your thumb has to land somewhere specific, and the circle starts out very small.',
    strategy: [
      'Hover your thumb over the middle of the screen before the round starts. From there the average distance to any random point is shortest.',
      'A miss costs the same as being slowest, so if you are not sure your tap will land inside, wait a fraction for the circle to grow. Half a second of patience beats a wasted round.',
      'Look at the screen as a whole rather than scanning for the dot. Peripheral vision catches a new shape appearing faster than a focused search does.',
      'Use the index finger instead of the thumb if you play with the phone on the table. It is more accurate on small targets.',
    ],
    variations: [
      'Phone down: everyone plays with the phone flat on the table and one hand behind their back.',
      'Off hand: non-dominant hand only, which turns everyone into a beginner at once.',
      'Top three safe: in a big room, only the three fastest hits are safe, and everyone else drinks. Turns a gentle round into a real one.',
    ],
    withoutAlcohol:
      'Strong Point is an aim-and-reaction test that does not need a drink to be competitive. The points already separate the sharp from the slow, and the loser can pay in a dare or a sip of water just as well.',
  },
  flying_bomb: {
    overview:
      'Flying Bomb is hot potato with phones. The room is seated on an invisible ring, a few bombs are dropped onto random screens, and a timer starts. Swipe a bomb left or right and it flies to that neighbour\'s phone. When the clock runs out, every bomb still on your screen is a chaser and 7 points against you. The number of bombs scales with the room, roughly one for every three players, so nobody gets to relax just because they are bomb-free right now.',
    strategy: [
      'Swipe the instant a bomb lands. Holding it to pick a direction is how you get caught with it when the timer ends.',
      'Your left and right neighbours stay the same for the whole round. If one of them keeps swiping the bomb straight back, send the next one the other way.',
      'Watch your own screen, not the room. The bomb arrives on your phone silently, and the players who lose are usually the ones looking up to see who has it.',
      'In a big room, two bombs can land on you at once. Swipe them in opposite directions so a single neighbour does not fire both straight back.',
    ],
    variations: [
      'One direction: the table agrees every bomb travels clockwise only. Simpler, faster, and it removes the ping-pong between two neighbours.',
      'No sound: silent round, no warnings allowed, and nobody may say who has a bomb.',
      'Shared blast: whoever is holding a bomb at the end also picks one neighbour to drink with them, since the neighbour clearly passed it over.',
    ],
    withoutAlcohol:
      'Flying Bomb is a frantic, physical, laugh-out-loud round with or without a drink at the end. Play it for points, or swap the chaser for a forfeit, and the panic when a bomb lands on your screen is exactly the same.',
  },
  twenty_one: {
    overview:
      '21 is the calmest game in Quickle and one of the deepest. A shared counter starts at 0 and passes around the table. On your turn you push it up by 1, 2 or 3, never past 21, and whoever is forced to land it on exactly 21 drinks two chasers. With two players it is a solved puzzle. With a full table it turns into a game of reading who is about to be trapped and quietly making sure it is not you.',
    strategy: [
      'The magic numbers are multiples of 4. If you leave the counter on 4, 8, 12, 16 or 20, the next player cannot avoid giving you another multiple of 4, and 20 forces them to hit 21.',
      'With three or more players, the maths only works for the last two moves. Focus on not being the person left on 18, 19 or 20 with the turn coming to you.',
      'Count ahead by seats. Before you move, work out who will be holding the counter when it reaches the high teens, and steer it so that it is not you.',
      'Small moves keep your options open early. Jumping by 3 every turn rushes the counter to the danger zone while it is still someone else\'s decision who lands there.',
    ],
    variations: [
      'Reverse: hitting 21 lets that player pick someone else to drink instead. Turns the end of the count into a negotiation.',
      'Pass once: each player may pass their turn once per game. It breaks the multiples-of-4 trick and rewards timing.',
      'Countdown: the table starts at 21 and counts down to 0 instead. Same maths, and a surprising number of people get it wrong the first time.',
    ],
    withoutAlcohol:
      '21 is a maths puzzle with a social layer, and the drink at the end is decoration. It plays perfectly for points, and it is the game most likely to have the table arguing about strategy long after the round has finished.',
  },
  auction: {
    overview:
      'Auction is the big-room game. A prize goes up for bidding: a pool of chasers that the winner gets to hand out to everyone else. Bids are made in two currencies at once, the chasers you would personally drink and the points you would pay, and every raise resets a 15-second clock. When the clock runs out, the highest bidder pays their bid, then distributes the prize around the table, with a cap of two chasers for any single victim. It needs at least five players, because an auction with three bidders is just a conversation.',
    strategy: [
      'Price the prize before you bid. The pool is worth handing out only if it is bigger than what you would drink to win it; a bid of three chasers for a pool of three is a losing trade.',
      'Points are the cheaper currency early in the night and the expensive one late. If you are ahead on the scoreboard, bid points; if you are behind, bid chasers.',
      'Every raise resets the clock, so a last-second bid is not a snipe, it is an invitation. The auction only ends when the room stops raising.',
      'Running up a rival is a real tactic. If someone clearly wants the prize, a raise that you do not intend to win forces them to pay more, but be sure they will actually outbid you.',
    ],
    variations: [
      'Sealed bids: everyone writes a single bid and reveals at once. No clock, no reading the room, just nerve.',
      'Chasers only: the table agrees that points may not be bid. Every auction becomes a straightforward question of how much you are willing to drink to make others drink more.',
      'Charity round: the winner must hand the whole pool to a single player, cap removed. Use with care.',
    ],
    withoutAlcohol:
      'Auction is a bargaining game, and the bargaining is the fun. Bid and pay in points only, or agree that chasers mean sips of water, and the bluffing, the running up and the last-second raises all still work.',
  },
  black_box: {
    overview:
      'Black Box is a two-player stand-off with the whole room watching. Two players are picked at random. Player 1 chooses one of six sealed boxes and sees what is inside: a Drink card or a Distribute card, each worth one to three chasers. A timer starts, and Player 2 has to decide whether to take the box or leave it. Player 1 can say anything in the meantime, and they will. When the clock ends, whoever is holding the box reveals it: a Drink card means you drink what it shows, a Distribute card means you hand those chasers out. Everyone not picked gets to watch someone bluff a friend to their face.',
    strategy: [
      'As Player 2, start from the deck, not the sales pitch. There are three Drink boxes and three Distribute boxes, so before a word is spoken the box is a coin flip. Everything Player 1 says is an attempt to move you off that.',
      'As Player 1, decide on a story and stick to it. Switching from "you really do not want this" to "fine, take it" halfway through the timer is the tell that gives the room the answer.',
      'Reverse psychology is expected, so sometimes the honest play is the strongest. A Player 1 who calmly says "it is a Distribute card, take it" holding a Drink card wins more often than one who begs.',
      'The points scale with the chasers on the card, up to plus or minus 15. A high-value card is worth fighting over; a one-chaser card barely moves the scoreboard either way.',
    ],
    variations: [
      'Silent box: Player 1 may not speak and can only communicate with facial expressions. Player 2 gets the full timer to stare at them.',
      'Jury vote: the rest of the room votes take or leave before Player 2 decides, and Player 2 may follow or ignore it.',
      'Best of three: the same two players run three boxes in a row, alternating who picks. Reputations build fast.',
    ],
    withoutAlcohol:
      'Black Box is a bluffing duel, and the crowd watching it does not care whether the card says drink or sip. Play it for the points, which already run to 15 either way, and the theatre of Player 1 talking Player 2 into a bad decision is untouched.',
  },
};

export function getGameGuide(id: string): GameGuide | undefined {
  return GAME_GUIDES[id];
}
