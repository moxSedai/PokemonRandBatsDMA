import {Dex} from '@pkmn/dex';
import {Generations} from '@pkmn/data';
import {calculate, Pokemon, Move, Field} from '@smogon/calc';

import {Battle} from '@pkmn/sim';
import {BattleStreams, RandomPlayerAI, Teams} from '@pkmn/sim';
import {TeamGenerators} from '@pkmn/randoms';

import pkg from 'lodash';
const { cloneDeep } = pkg;
import {readFile} from 'node:fs/promises'
import {createInterface} from "readline";


var playerNum
var enemyNum

var progress = 0
var maxProgress = 1

// Define custom volatile statuses for use in state generation

const fixedDamage = {
    name: 'fixedDamage',
    onStart(pokemon) {
        this.add('-start', pokemon, 'fixedDamage');
    },
    onEnd(pokemon) {
        this.add('-end', pokemon, 'fixedDamage');
    },
}

const guaranteeSecondary = {
    name: 'guaranteeSecondary',
    duration: 1,
    onModifyMove(move) {
        move.secondary.chance = 100;
    },
    onEnd(pokemon) {
        this.add('-end', pokemon, 'guaranteeSecondary')
    }
}

const guaranteeMiss = {
    name: 'guaranteeMiss',
    duration: 1,
    onModifyMove(move) {
        move.accuracy = 0;
    }
}

const guaranteeHit = {
    name: 'guaranteeHit',
    duration: 1,
    onModifyMove(move) {
        move.accuracy = true;
    }
}

const guaranteeParaFlinch = {
    name: 'guaranteeParaFlinch',
    duration: 1,
    onStart(pokemon) {
        this.add('-start', pokemon, 'guaranteeParaFlinch')
    },
    onBeforeMovePriority: 100,
    onBeforeMove(pokemon) {
        this.add('-activate', pokemon, 'paralyzed')
        this.add('-message', `${pokemon.name} is fully paralyzed and can't move!`)
        return false;
    },
    onEnd(pokemon) {
        this.add('-end', pokemon, 'guaranteeParaFlinch')
    }
}

const physicalMoves = {
    'Normal': 'Body Slam',
    'Fire': 'Blaze Kick',
    'Water': 'Waterfall',
    'Electric': 'Thunder Punch',
    'Grass': 'Leaf Blade',
    'Ice': 'Icicle Crash',
    'Fighting': 'Sky Uppercut',
    'Poison': 'Poison Jab',
    'Ground': 'Earthquake',
    'Flying': 'Drill Peck',
    'Psychic': 'Zen Headbutt',
    'Bug': 'X-Scissor',
    'Rock': 'Stone Edge',
    'Ghost': 'Shadow Claw',
    'Dragon': 'Dragon Claw',
    'Dark': 'Crunch',
    'Steel': 'Iron Head',
    'Fairy': 'Play Rough'
}
const specialMoves = {
    'Normal': 'Hyper Voice',
    'Fire': 'Flamethrower',
    'Water': 'Surf',
    'Electric': 'Thunderbolt',
    'Grass': 'Energy Ball',
    'Ice': 'Ice Beam',
    'Fighting': 'Aura Sphere',
    'Poison': 'Sludge Bomb',
    'Ground': 'Earth Power',
    'Flying': 'Air Slash',
    'Psychic': 'Psychic',
    'Bug': 'Bug Buzz',
    'Rock': 'Power Gem',
    'Ghost': 'Shadow Ball',
    'Dragon': 'Dragon Pulse',
    'Dark': 'Dark Pulse',
    'Steel': 'Flash Cannon',
    'Fairy': 'Moonblast'
}
const typeMatchups = {
    'Normal': ['Normal', 'Flying', 'Fairy', 'Fire'],
    'Fire': ['Fire', 'Ground', 'Rock', 'Electric'],
    'Water': ['Water', 'Electric', 'Grass', 'Ice'],
    'Electric': ['Electric', 'Ground', 'Grass', 'Water'],
    'Grass': ['Grass', 'Flying', 'Fire', 'Rock'],
    'Ice': ['Ice', 'Rock', 'Fire', 'Fighting'],
    'Fighting': ['Fighting', 'Psychic', 'Flying', 'Electric'],
    'Poison': ['Poison', 'Ground', 'Psychic', 'Bug'],
    'Ground': ['Ground', 'Grass', 'Ice', 'Rock'],
    'Flying': ['Flying', 'Electric', 'Rock', 'Steel'],
    'Psychic': ['Psychic', 'Bug', 'Dark', 'Fire'],
    'Bug': ['Bug', 'Flying', 'Rock', 'Fighting'],
    'Rock': ['Rock', 'Water', 'Grass', 'Bug'],
    'Ghost': ['Ghost', 'Dark', 'Fairy', 'Psychic'],
    'Dragon': ['Dragon', 'Ice', 'Fairy', 'Steel'],
    'Dark': ['Dark', 'Bug', 'Fairy', 'Ghost'],
    'Steel': ['Steel', 'Fire', 'Ground', 'Electric'],
    'Fairy': ['Fairy', 'Steel', 'Poison', 'Electric']
};


class uncertainPokemon {
    id;
    pokemon;
    moves;
    items;
    abilities;

    constructor(id, pokemon) {
        this.id = id
        this.pokemon = pokemon
        this.moves = []

    }
    setPokemon(pokemon) {
        this.pokemon = pokemon
        this.moves = []
    }
}


function checkPokemonEquality(poke1, poke2, withHP=true, verbose=false) {
    //Check name
    if (poke1.name !== poke2.name)
        return false
    if (poke1.name === "Magikarp")
        return poke2.name === "Magikarp"

    //Check move pp
    for(let i=0; i<4; i++) {
        try {
            if (poke1.moves[i].pp !== poke2.moves[i].pp)
                return false
        }
        catch {
            return false
        }
    }

    // Check status
    if (poke1.status !== poke2.status)
        return false

    // Check boosts
    if (poke1.boosts.atk !== poke2.boosts.atk ||
        poke1.boosts.def !== poke2.boosts.def ||
        poke1.boosts.spa !== poke2.boosts.spa ||
        poke1.boosts.spd !== poke2.boosts.spd ||
        poke1.boosts.spe !== poke2.boosts.spe ||
        poke1.boosts.accuracy !== poke2.boosts.accuracy ||
        poke1.boosts.evasion !== poke2.boosts.evasion)
        return false

    // Check Item
    if (poke1.item !== poke2.item)
        return false

    // Check Types (tera)
    for (let i=0; i<poke1.types.length; i++) {
        if (!poke2.types[i])
            return false
        if (poke1.types[i] !== poke2.types[i])
            return false
    }

    // Check HP
    if (withHP) {
        if (poke1.hp !== poke2.hp)
            return false
    }

    return true
}

class State {
    reward;
    team;
    enemyTeam;
    sim;

    enemyMovesKnown = [0, 0, 0, 0, 0, 0]

    activeMon = [0, 0]

    constructor(team, enemyTeam, sim, enemyMovesKnown) {
        this.reward = 0
        this.team = team
        this.enemyTeam = enemyTeam
        this.sim = sim
        for (let i=enemyTeam.length; i<6; i++) {
            this.enemyTeam.push(new uncertainPokemon(i))
        }
    }

    checkEqual(other, checkHP=true) {
        // Check pokemon equality
        for (let i=0; i<6; i++) {
            if (checkPokemonEquality(this.sim.sides[playerNum-1].pokemon[i], other.sim.sides[playerNum-1].pokemon[i], checkHP) === false)
                return false
        }
        for (let i=0; i<6; i++) {
            if (this.sim.sides[enemyNum-1].pokemon[i]) {
                if (other.sim.sides[enemyNum-1].pokemon[i]) {
                    if (checkPokemonEquality(this.sim.sides[enemyNum-1].pokemon[i], other.sim.sides[enemyNum-1].pokemon[i], checkHP) === false)
                        return false
                }
                else
                    return false
            }
        }
        if (this.sim.field.weather !== other.sim.field.weather)
            return false
        if (this.sim.field.terrain !== other.sim.field.terrain)
            return false

        return true
    }

    calc_reward() {
        let curSum = 0

        for(let i=0; i<6; i++) {
            let monSum = 0
            // Add current HP %
            monSum += this.sim.sides[playerNum-1].pokemon[i]['hp'] / this.sim.sides[playerNum-1].pokemon[i]['maxhp']

            // Add 1 if alive
            if (this.sim.sides[playerNum-1].pokemon[i].hp > 0)
                monSum += 1

            // Condition multipliers
            if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'brn')
                monSum *= 0.75
            else if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'psn')
                monSum *= 0.75
            else if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'tox')
                monSum *= 0.5
            else if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'slp')
                monSum *= 0.65
            else if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'par')
                monSum *= 0.5
            else if (this.sim.sides[playerNum-1].pokemon[i]['status'] === 'frz')
                monSum *= 0.25

            // Add to the sum
            curSum += monSum


            //Subtract the same for the enemy
            monSum = 0


            // Add 1 if alive
            if (this.sim.sides[enemyNum-1].pokemon[i]) {
                // Add current HP %
                monSum += this.sim.sides[enemyNum-1].pokemon[i].hp / this.sim.sides[enemyNum-1].pokemon[i].maxhp
                if (this.sim.sides[enemyNum-1].pokemon[i].hp > 0)
                    monSum += 1

                // Condition multipliers
                if (this.sim.sides[enemyNum-1].pokemon[i].status === 'brn')
                    monSum *= 0.75
                else if (this.sim.sides[enemyNum-1].pokemon[i].status === 'psn')
                    monSum *= 0.75
                else if (this.sim.sides[enemyNum-1].pokemon[i].status === 'tox')
                    monSum *= 0.5
                else if (this.sim.sides[enemyNum-1].pokemon[i].status === 'slp')
                    monSum *= 0.65
                else if (this.sim.sides[enemyNum-1].pokemon[i].status === 'par')
                    monSum *= 0.5
                else if (this.sim.sides[enemyNum-1].pokemon[i].status === 'frz')
                    monSum *= 0.25
            }
            else {
                monSum = 2
            }

            // Subtract from the sum
            curSum -= monSum
        }

        return curSum
    }
}


// Consts
const gens = new Generations(Dex);
const gen = gens.get(9);

const inpt = `Mew @ Life Orb
Ability: Synchronize
Level: 82
Tera Type: Fighting
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD / 85 Spe
- Leech Life
- Close Combat
- Psychic Fangs
- Swords Dance

Slowbro (Slowbro-Galar) @ Life Orb
Ability: Regenerator
Level: 87
Tera Type: Poison
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD
IVs: 0 Spe
- Trick Room
- Fire Blast
- Psychic
- Shell Side Arm

Cramorant @ Heavy-Duty Boots
Ability: Gulp Missile
Level: 86
Tera Type: Ground
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD / 85 Spe
- Surf
- Roost
- Brave Bird
- Defog

Seviper @ Life Orb
Ability: Infiltrator
Level: 93
Tera Type: Fire
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD / 85 Spe
- Flamethrower
- Giga Drain
- Gunk Shot
- Knock Off

Walking Wake @ Choice Specs
Ability: Protosynthesis
Level: 79
Tera Type: Fire
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD / 85 Spe
- Hydro Pump
- Draco Meteor
- Flamethrower
- Flip Turn

Houndstone @ Choice Band
Ability: Fluffy
Level: 86
Tera Type: Fighting
EVs: 85 HP / 85 Atk / 85 Def / 85 SpA / 85 SpD / 85 Spe
- Play Rough
- Shadow Sneak
- Poltergeist
- Body Press `
const oldLogs = [
    [
        "<< >othermetas\n|L| jfm"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955129\n|move|p1a: Serperior|Tera Blast|p2a: Ariados|[anim] Tera Blast Fire\n|-supereffective|p2a: Ariados\n|-damage|p2a: Ariados|6/100\n|move|p2a: Ariados|Toxic Spikes|p1a: Serperior\n|-sidestart|p1: NycRey|move: Toxic Spikes\n|\n|-heal|p1a: Serperior|68/100|[from] item: Leftovers\n|upkeep\n|turn|3"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955136\n|move|p1a: Serperior|Tera Blast|p2a: Ariados|[anim] Tera Blast Fire\n|-supereffective|p2a: Ariados\n|-damage|p2a: Ariados|0 fnt\n|faint|p2a: Ariados\n|\n|-heal|p1a: Serperior|74/100|[from] item: Leftovers\n|upkeep"
    ],
    [
        "<< >othermetas\n|J| Alex0621!"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955145\n|switch|p2a: Ursaluna|Ursaluna, L79, M|100/100\n|turn|4"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955152\n|move|p1a: Serperior|Substitute|p1a: Serperior\n|-start|p1a: Serperior|Substitute\n|-damage|p1a: Serperior|49/100\n|move|p2a: Ursaluna|Swords Dance|p2a: Ursaluna\n|-boost|p2a: Ursaluna|atk|2\n|\n|-heal|p1a: Serperior|55/100|[from] item: Leftovers\n|-status|p2a: Ursaluna|brn|[from] item: Flame Orb\n|upkeep\n|turn|5"
    ],
    [
        "<< >othermetas\n|L| skyrimshffl"
    ],
    [
        "<< >othermetas\n|J| jaden125"
    ],
    [
        "<< >othermetas\n|L| Archaludon12"
    ],
    [
        "<< >othermetas\n|c:|1731955164| Slothy0wl|why would it?"
    ],
    [
        "<< >othermetas\n|L| oeuf breaddd"
    ],
    [
        "<< >othermetas\n|L| jaden125"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955169\n|move|p1a: Serperior|Leaf Storm|p2a: Ursaluna|[miss]\n|-miss|p1a: Serperior|p2a: Ursaluna\n|move|p2a: Ursaluna|Headlong Rush|p1a: Serperior\n|-supereffective|p1a: Serperior\n|-end|p1a: Serperior|Substitute\n|-unboost|p2a: Ursaluna|def|1\n|-unboost|p2a: Ursaluna|spd|1\n|\n|-heal|p1a: Serperior|61/100|[from] item: Leftovers\n|-damage|p2a: Ursaluna|95/100 brn|[from] brn\n|upkeep\n|turn|6"
    ],
    [
        "<< >othermetas\n|L| Carlosbpp"
    ],
    [
        "<< >othermetas\n|c:|1731955172|#KaenSoul|only from stuff afected by sheer force"
    ],
    [
        "<< >othermetas\n|L| LordArmin"
    ],
    [
        "<< >othermetas\n|c:|1731955181| Shardmaw|yeah that's what I thought"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955183\n|move|p1a: Serperior|Leaf Storm|p2a: Ursaluna\n|-supereffective|p2a: Ursaluna\n|-damage|p2a: Ursaluna|0 fnt\n|-boost|p1a: Serperior|spa|2\n|faint|p2a: Ursaluna\n|\n|-heal|p1a: Serperior|67/100|[from] item: Leftovers\n|upkeep"
    ],
    [
        "<< >othermetas\n|L| aerstd2"
    ],
    [
        "<< >othermetas\n|J| aerstd2"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955195\n|switch|p2a: Gouging Fire|Gouging Fire, L74|100/100\n|turn|7"
    ],
    [
        "<< >othermetas\n|J| Kansas500"
    ],
    [
        "<< >othermetas\n|c:|1731955202| Shardmaw|slothyowl cause it's effect on salt Cure is strange to me"
    ],
    [
        "<< >othermetas\n|L| StonySix"
    ],
    [
        "<< >othermetas\n|L| BigDannyMason"
    ],
    [
        "<< >othermetas\n|J| BigDannyMason"
    ],
    [
        "<< >othermetas\n|L| code red ccxx"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955222\n|move|p1a: Serperior|Substitute|p1a: Serperior\n|-start|p1a: Serperior|Substitute\n|-damage|p1a: Serperior|42/100\n|move|p2a: Gouging Fire|Dragon Dance|p2a: Gouging Fire\n|-boost|p2a: Gouging Fire|atk|1\n|-boost|p2a: Gouging Fire|spe|1\n|\n|-heal|p1a: Serperior|48/100|[from] item: Leftovers\n|upkeep\n|turn|8"
    ],
    [
        "<< >othermetas\n|J| zdzd zdzd"
    ],
    [
        "<< >othermetas\n|c:|1731955236| Slothy0wl|Salt cure is sheer force boosted"
    ],
    [
        "<< >othermetas\n|L| vgclth chromate"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955240\n|move|p2a: Gouging Fire|Dragon Dance|p2a: Gouging Fire\n|-boost|p2a: Gouging Fire|atk|1\n|-boost|p2a: Gouging Fire|spe|1\n|move|p1a: Serperior|Leaf Storm|p2a: Gouging Fire\n|-resisted|p2a: Gouging Fire\n|-damage|p2a: Gouging Fire|81/100\n|-boost|p1a: Serperior|spa|2\n|\n|-heal|p1a: Serperior|54/100|[from] item: Leftovers\n|upkeep\n|turn|9"
    ],
    [
        "<< >othermetas\n|c:|1731955246| Shardmaw|yeah"
    ],
    [
        "<< >othermetas\n|L| ennenne"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955260\n|move|p2a: Gouging Fire|Heat Crash|p1a: Serperior\n|-resisted|p1a: Serperior\n|-end|p1a: Serperior|Substitute\n|move|p1a: Serperior|Leaf Storm|p2a: Gouging Fire\n|-resisted|p2a: Gouging Fire\n|-damage|p2a: Gouging Fire|55/100\n|-boost|p1a: Serperior|spa|2\n|\n|-heal|p1a: Serperior|60/100|[from] item: Leftovers\n|upkeep\n|turn|10"
    ],
    [
        "<< >othermetas\n|L| Maxifario"
    ],
    [
        "<< >othermetas\n|L| madzakers"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955274\n|move|p2a: Gouging Fire|Outrage|p1a: Serperior\n|-damage|p1a: Serperior|0 fnt\n|faint|p1a: Serperior\n|\n|upkeep"
    ],
    [
        "<< >othermetas\n|J|‽TheFANDOM_Hero"
    ],
    [
        "<< >othermetas\n|N|‽TheFANDOM_Hero|thefandomhero"
    ],
    [
        "<< >othermetas\n|J| Tsormein"
    ],
    [
        "<< >othermetas\n|J|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|NycRey has 120 seconds left."
    ],
    [
        "<< >othermetas\n|J| notagreatrainer"
    ],
    [
        "<< >othermetas\n|L| Inciname"
    ],
    [
        "<< >othermetas\n|N| Les2BG|les2bg"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955316\n|switch|p1a: Camerupt|Camerupt, L91, M|100/100\n|-status|p1a: Camerupt|psn\n|turn|11"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|NycRey has 90 seconds left.\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955338\n|move|p2a: Gouging Fire|Outrage|p1a: Camerupt|[from]lockedmove\n|-damage|p1a: Camerupt|5/100 psn\n|-start|p2a: Gouging Fire|confusion|[fatigue]\n|move|p1a: Camerupt|Earthquake|p2a: Gouging Fire\n|-supereffective|p2a: Gouging Fire\n|-damage|p2a: Gouging Fire|0 fnt\n|faint|p2a: Gouging Fire\n|-end|p2a: Gouging Fire|Protosynthesis|[silent]\n|\n|-heal|p1a: Camerupt|11/100 psn|[from] item: Leftovers\n|-damage|p1a: Camerupt|0 fnt|[from] psn\n|faint|p1a: Camerupt\n|upkeep"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|NycRey has 90 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955370\n|switch|p2a: Articuno|Articuno-Galar, L84|100/100\n|switch|p1a: Glalie|Glalie, L96, M|100/100\n|turn|12"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >othermetas\n|J| Nx07"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955388\n|move|p1a: Glalie|Disable||[still]\n|-fail|p1a: Glalie\n|move|p2a: Articuno|Hurricane|p1a: Glalie\n|-damage|p1a: Glalie|54/100\n|\n|upkeep\n|turn|13"
    ],
    [
        "<< >othermetas\n|J| Plan B Placebo"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955399\n|move|p2a: Articuno|Calm Mind|p2a: Articuno\n|-boost|p2a: Articuno|spa|1\n|-boost|p2a: Articuno|spd|1\n|move|p1a: Glalie|Freeze-Dry|p2a: Articuno\n|-supereffective|p2a: Articuno\n|-damage|p2a: Articuno|64/100\n|\n|upkeep\n|turn|14"
    ],
    [
        "<< >othermetas\n|J| ChoiceBandEmolga"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|Frothyice has 120 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955405\n|move|p2a: Articuno|Calm Mind|p2a: Articuno\n|-boost|p2a: Articuno|spa|1\n|-boost|p2a: Articuno|spd|1\n|move|p1a: Glalie|Freeze-Dry|p2a: Articuno\n|-supereffective|p2a: Articuno\n|-damage|p2a: Articuno|37/100\n|\n|upkeep\n|turn|15"
    ],
    [
        "<< >othermetas\n|L| Plan B Placebo"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955413\n|move|p1a: Glalie|Freeze-Dry|p2a: Articuno\n|-supereffective|p2a: Articuno\n|-damage|p2a: Articuno|12/100\n|move|p2a: Articuno|Freezing Glare|p1a: Glalie\n|-damage|p1a: Glalie|0 fnt\n|faint|p1a: Glalie\n|\n|upkeep"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955420\n|switch|p1a: Zamazenta|Zamazenta, L71|100/100\n|-status|p1a: Zamazenta|psn\n|-ability|p1a: Zamazenta|Dauntless Shield|boost\n|-boost|p1a: Zamazenta|def|1\n|turn|16"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|inactive|NycRey has 90 seconds left."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955430\n|move|p1a: Zamazenta|Iron Head|p2a: Articuno\n|-damage|p2a: Articuno|0 fnt\n|faint|p2a: Articuno\n|\n|-damage|p1a: Zamazenta|88/100 psn|[from] psn\n|upkeep"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955437\n|switch|p2a: Arbok|Arbok, L87, F|100/100\n|-ability|p2a: Arbok|Intimidate|boost\n|-unboost|p1a: Zamazenta|atk|1\n|turn|17"
    ],
    [
        "<< >othermetas\n|J| Goundas05"
    ],
    [
        "<< >othermetas\n|N| RastaHimbo|rastahimbo"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|t:|1731955446\n|move|p1a: Zamazenta|Body Press|p2a: Arbok\n|-resisted|p2a: Arbok\n|-damage|p2a: Arbok|75/100\n|move|p2a: Arbok|Earthquake|p1a: Zamazenta\n|-damage|p1a: Zamazenta|65/100 psn\n|-damage|p2a: Arbok|65/100|[from] item: Life Orb\n|\n|-heal|p1a: Zamazenta|71/100 psn|[from] item: Leftovers\n|-damage|p1a: Zamazenta|58/100 psn|[from] psn\n|upkeep\n|turn|18"
    ],
    [
        "<< >othermetas\n|L|shardmaw"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|-message|Frothyice forfeited."
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|\n|win|NycRey"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|raw|NycRey's rating: 1041 &rarr; <strong>1074</strong><br />(+33 for winning)\n|raw|Frothyice's rating: 1029 &rarr; <strong>1015</strong><br />(-14 for losing)"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|l|☆Frothyice"
    ],
    [
        "<< >othermetas\n|L| brownboss"
    ],
    [
        "<< >othermetas\n|L| Docter_Peng99"
    ],
    [
        "<< >battle-gen9randombattle-2246364872\n|player|p2|\n|l|☆NycRey"
    ],
    [
        "<< >othermetas\n|J| Iliketheseodds"
    ],
    [
        "<< >othermetas\n|J| Ren"
    ],
    [
        "<< >othermetas\n|J| forestfirev2"
    ],
    [
        "<< >othermetas\n|J| DizzyMichaelSword"
    ],
    [
        "<< >othermetas\n|L| seamlessstan"
    ],
    [
        "<< >othermetas\n|L|%Pecha Nerd"
    ],
    [
        "<< >othermetas\n|J|%Pecha Nerd"
    ],
    [
        "<< >othermetas\n|J| brayboa"
    ],
    [
        "<< >othermetas\n|L| mthw"
    ],
    [
        "<< >othermetas\n|J| samarsingh25"
    ],
    [
        "<< >othermetas\n|J| gdfox802"
    ],
    [
        "<< >othermetas\n|J| Briallo"
    ],
    [
        "<< >othermetas\n|L| NotZzephyr"
    ],
    [
        "<< >othermetas\n|L| gamer42069epic"
    ],
    [
        "<< >othermetas\n|J| bearattackvictim"
    ],
    [
        "<< >othermetas\n|L| skyheavy"
    ],
    [
        "<< >othermetas\n|J| brownboss"
    ],
    [
        "<< >othermetas\n|L| Briallo"
    ],
    [
        "<< >othermetas\n|J| jamaicanbeefpatty"
    ],
    [
        "<< >othermetas\n|J| Calatouff"
    ],
    [
        "<< >othermetas\n|L| give maus cookie"
    ],
    [
        "<< >othermetas\n|N| Mayburi|dizzymichaelsword"
    ],
    [
        "<< >othermetas\n|L| catboyfricker522"
    ],
    [
        "<< >othermetas\n|J| 0_Mirage"
    ],
    [
        "<< >othermetas\n|J| Cee o-o"
    ],
    [
        "<< >othermetas\n|J| melmetal fanboy"
    ],
    [
        "<< >othermetas\n|J| ioupio"
    ],
    [
        "<< >othermetas\n|L| samarsingh25"
    ],
    [
        "<< >othermetas\n|L| Afox4567"
    ],
    [
        "<< >othermetas\n|J| Afox4567"
    ],
    [
        "<< >othermetas\n|N| Raymario Pokenic|raymariopokenic"
    ],
    [
        "<< >othermetas\n|L| aerstd2"
    ],
    [
        "<< >othermetas\n|L| Nx07"
    ],
    [
        "<< >othermetas\n|J| Daddy Mewtwo"
    ],
    [
        "<< >othermetas\n|J| Plan B Placebo"
    ],
    [
        "<< >othermetas\n|J| nobissin"
    ],
    [
        "<< >othermetas\n|c:|1731955733|‽pannuracotta|stab game anyone?"
    ],
    [
        "<< >othermetas\n|J| Qubanos"
    ],
    [
        "<< >othermetas\n|J| aduno tal"
    ],
    [
        "<< >othermetas\n|J| Sheep.Professional"
    ],
    [
        "<< >othermetas\n|J| samarsingh25"
    ],
    [
        "<< >othermetas\n|L| Butler Of Pinkie"
    ],
    [
        "<< >othermetas\n|c:|1731955751|‽pannuracotta|hi Glory Clas"
    ],
    [
        "<< >othermetas\n|L| aduno tal"
    ],
    [
        "<< >othermetas\n|L| Redmansgreed"
    ],
    [
        "<< >othermetas\n|J| Baldumoto"
    ],
    [
        "<< >othermetas\n|L| mase11"
    ],
    [
        "<< >othermetas\n|J| MagneticSpirit"
    ],
    [
        "<< >othermetas\n|J| Dimitriy"
    ],
    [
        "<< >othermetas\n|L| Raoul Sanchez"
    ],
    [
        "<< >othermetas\n|L| jamaicanbeefpatty"
    ],
    [
        "<< >othermetas\n|J| idontwearsweaters"
    ],
    [
        "<< >othermetas\n|J| mase11"
    ],
    [
        "<< >othermetas\n|J| Raoul Sanchez"
    ],
    [
        "<< >othermetas\n|L| Goundas05"
    ],
    [
        "<< >othermetas\n|J| BanHippopotas"
    ],
    [
        "<< >othermetas\n|J| SozzledBupkis"
    ],
    [
        "<< >othermetas\n|J| ironsleeves"
    ],
    [
        "<< >othermetas\n|J|+Pure Hackmons"
    ],
    [
        "<< >othermetas\n|L| Nusuka"
    ],
    [
        "<< >othermetas\n|L| Tsormein"
    ],
    [
        "<< >othermetas\n|J| Nx07"
    ],
    [
        "<< >othermetas\n|c:|1731955836| Glory|ew"
    ],
    [
        "<< >othermetas\n|L| geidigrimes"
    ],
    [
        "<< >othermetas\n|J|✩jl36808pausdus"
    ],
    [
        "<< >othermetas\n|c:|1731955879|‽pannuracotta|Ok Man."
    ],
    [
        "<< >othermetas\n|J| Briallo"
    ],
    [
        "<< >othermetas\n|L| Nx07"
    ],
    [
        "<< >othermetas\n|L|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|L| ratbrggr2"
    ],
    [
        "<< >othermetas\n|c:|1731955943| Ren|ill play raco"
    ],
    [
        "<< >othermetas\n|J| AstilCodex"
    ],
    [
        "<< >othermetas\n|L| pornofilo"
    ],
    [
        "<< >othermetas\n|J| ones1ngleplayer"
    ],
    [
        "<< >othermetas\n|c:|1731955963| Ren|wait do i even have a stab team"
    ],
    [
        "<< >othermetas\n|J|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        "<< >othermetas\n|c:|1731955966| Ren|who knows"
    ],
    [
        "<< >othermetas\n|J| Nx07"
    ],
    [
        "<< >othermetas\n|L| melmetal fanboy"
    ],
    [
        "<< >othermetas\n|L| StormJet1613"
    ],
    [
        "<< >othermetas\n|J| Greatcascade"
    ],
    [
        "<< >othermetas\n|L| Kansas500"
    ],
    [
        "<< >othermetas\n|J| yoshimiShihtzu"
    ],
    [
        "<< >othermetas\n|J| blade murphy"
    ],
    [
        "<< >othermetas\n|J| RenegadePenguin3"
    ],
    [
        "<< >othermetas\n|L| ioupio"
    ],
    [
        "<< >othermetas\n|L| Greatcascade"
    ],
    [
        "<< >othermetas\n|L| samarsingh25"
    ],
    [
        "<< >othermetas\n|L| Alternate Oib"
    ],
    [
        "<< >othermetas\n|L| RichieF"
    ],
    [
        "<< >othermetas\n|L| yoshimiShihtzu"
    ],
    [
        "<< >othermetas\n|J| samarsingh25"
    ],
    [
        "<< >othermetas\n|L| nobissin"
    ],
    [
        "<< >othermetas\n|L| nice boy 78"
    ],
    [
        "<< >othermetas\n|J|‽BFO Ethanol"
    ],
    [
        "<< >othermetas\n|J|‽TotallyABotter"
    ],
    [
        "<< >othermetas\n|N| Darth Xman@!|darthxman"
    ],
    [
        "<< >othermetas\n|N|~dhelmise@!|dhelmise"
    ],
    [
        "<< >othermetas\n|N| golypoly@!|golypoly"
    ],
    [
        "<< >othermetas\n|N| Cat Steven@!|catsteven"
    ],
    [
        "<< >othermetas\n|J| nobissin"
    ],
    [
        "<< >othermetas\n|L| Xx(NiKax)X"
    ],
    [
        "<< >othermetas\n|L| nobissin"
    ],
    [
        "<< >othermetas\n|L| cerularge"
    ],
    [
        "<< >othermetas\n|L| tay_54"
    ],
    [
        "<< >othermetas\n|J| whaddya say pk?"
    ],
    [
        "<< >othermetas\n|J| candydoestests"
    ],
    [
        "<< >othermetas\n|L| Nx07"
    ],
    [
        "<< >othermetas\n|J| Nx07"
    ],
    [
        "<< >othermetas\n|c:|1731956191|‽pannuracotta|i dont like you"
    ],
    [
        "<< >othermetas\n|J| nobissin"
    ],
    [
        "<< >othermetas\n|J|‽blonkus"
    ],
    [
        "<< >othermetas\n|L| nobissin"
    ],
    [
        "<< >othermetas\n|J| Docter_Peng99"
    ],
    [
        "<< >othermetas\n|J| Dropamine"
    ],
    [
        "<< >othermetas\n|L| sol ringer"
    ],
    [
        "<< >othermetas\n|J| salsa1133"
    ],
    [
        "<< >othermetas\n|J| the rch"
    ],
    [
        "<< >othermetas\n|L|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|J|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        "<< >othermetas\n|L| MagneticSpirit"
    ],
    [
        "<< >othermetas\n|L| candydoestests"
    ],
    [
        "<< >othermetas\n|J| candydoestests"
    ],
    [
        "<< >othermetas\n|J| indigo ketchup"
    ],
    [
        "<< >othermetas\n|L| salsa1133"
    ],
    [
        "<< >othermetas\n|L| Cee o-o"
    ],
    [
        "<< >othermetas\n|L| Boadupczyciel"
    ],
    [
        "<< >othermetas\n|J| poop342424"
    ],
    [
        "<< >othermetas\n|L| poop342424"
    ],
    [
        "<< >othermetas\n|J|@yuki"
    ],
    [
        "<< >othermetas\n|J| bantheworm5"
    ],
    [
        "<< >othermetas\n|J| ioupio"
    ],
    [
        "<< >othermetas\n|J| Hehehejndnmd"
    ],
    [
        "<< >othermetas\n|L| Crysantimo"
    ],
    [
        "<< >othermetas\n|J| Six Spoons"
    ],
    [
        "<< >othermetas\n|J| Simplyxaidqn"
    ],
    [
        "<< >othermetas\n|L| samarsingh25"
    ],
    [
        "<< >othermetas\n|J| TruelyJoshV"
    ],
    [
        "<< >othermetas\n|L| bantheworm5"
    ],
    [
        "<< >othermetas\n|L| mase11"
    ],
    [
        "<< >othermetas\n|L|iliketheseodds"
    ],
    [
        "<< >othermetas\n|J| gamewolf378"
    ],
    [
        "<< >othermetas\n|L| forestfirev2"
    ],
    [
        "<< >othermetas\n|J| eor j(je_ejnco"
    ],
    [
        "<< >othermetas\n|J| domada87"
    ],
    [
        "<< >othermetas\n|J| Shardmaw"
    ],
    [
        "<< >othermetas\n|L|✩jl36808pausdus"
    ],
    [
        "<< >othermetas\n|L| gdfox802"
    ],
    [
        "<< >othermetas\n|J| samarsingh25"
    ],
    [
        "<< >othermetas\n|N| Darth Xman|darthxman"
    ],
    [
        "<< >othermetas\n|J| bantheworm5"
    ],
    [
        "<< >othermetas\n|J| Nusuka"
    ],
    [
        "<< >othermetas\n|L| Afox4567"
    ],
    [
        "<< >othermetas\n|L|+Dragonillis"
    ],
    [
        "<< >othermetas\n|J|#kenn"
    ],
    [
        "<< >othermetas\n|N| eweopo|indigoketchup"
    ],
    [
        "<< >othermetas\n|J| Dr4g0nUch1ha"
    ],
    [
        "<< >othermetas\n|L| the rch"
    ],
    [
        "<< >othermetas\n|J| pokesnaker"
    ],
    [
        "<< >othermetas\n|J|+frostyicelad"
    ],
    [
        "<< >othermetas\n|L| idontwearsweaters"
    ],
    [
        "<< >othermetas\n|N| indigo ketchup|eweopo"
    ],
    [
        "<< >othermetas\n|J| oeuf breaddd"
    ],
    [
        "<< >othermetas\n|L| pokesnaker"
    ],
    [
        "<< >othermetas\n|L|+frostyicelad"
    ],
    [
        "<< >othermetas\n|L| Plan B Placebo"
    ],
    [
        "<< >othermetas\n|J| kissalexi"
    ],
    [
        "<< >othermetas\n|L| eduardmotrea"
    ],
    [
        "<< >othermetas\n|J| ilikeplayingroblox"
    ],
    [
        "<< >othermetas\n|J| yoshifanfic"
    ],
    [
        "<< >othermetas\n|L| Meltan808"
    ],
    [
        "<< >othermetas\n|L| indigo ketchup"
    ],
    [
        "<< >othermetas\n|J| indigo ketchup"
    ],
    [
        "<< >othermetas\n|L| indigo ketchup"
    ],
    [
        "<< >othermetas\n|J| indigo ketchup"
    ],
    [
        "<< >othermetas\n|L| indigo ketchup"
    ],
    [
        "<< >othermetas\n|L| Mayburi"
    ],
    [
        "<< >othermetas\n|J| indigo ketchup"
    ],
    [
        "<< >othermetas\n|J| jejejcusi"
    ],
    [
        "<< >othermetas\n|N| indigo ketchupegg|indigoketchup"
    ],
    [
        "<< >othermetas\n|L| Raoul Sanchez"
    ],
    [
        "<< >othermetas\n|J| Mayburi"
    ],
    [
        "<< >othermetas\n|L|‽TotallyABotter"
    ]
]
const logs = [
    [
        "<< >othermetas\n|L| chipchocolat"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":801,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":307,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":477,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":34,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":43,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":36,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":213,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":21,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":201,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":541,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":77,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":91,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":37,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":33,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":10,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":33,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":79,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":38,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":137,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":112,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":438,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":31,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":55,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":412,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":18,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":14,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":203,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":36,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":41,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":29,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":27,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18074,\"battleCount\":2977}"
    ],
    [
        "<< >othermetas\n|N| aidan amoongus|aidanamoongus4"
    ],
    [
        "<< >othermetas\n|J| jumpscare lord"
    ],
    [
        "<< >othermetas\n|J| Battlep"
    ],
    [
        "<< >othermetas\n|N| jumpscare lord|jumpscarelord"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":808,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":310,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":477,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":34,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":46,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":42,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":43,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":35,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":212,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":203,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":542,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":90,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":280,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":37,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":33,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":37,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":133,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":113,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":439,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":82,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":125,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":31,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":57,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":411,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":18,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":14,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":204,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":37,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":55,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18111,\"battleCount\":3001}"
    ],
    [
        ">> |/trn moxSedai,0,6292328ab1f181714290b05e109c004a28496e992d0b1f2b7c0463d5a5e41d95469fd8cc287b8327761a1e7242c60db1ad13f29848a8a0d4d119b046e9dd5774ba9fd0c19dfa45401c2a527ff3e943eabc12f7ffc7d1e361a16548fe778513e30027279aa50ce2255f4e035552de9ced2487e56ec0c9929cb6e37fd0d3a6e0c5,moxsedai,4,1732648085,sim3.psim.us,5fcc349f19fabe391732648084,720bbec8be21aad9,b924bc64501c7df6;b3a9ac2e1672cfe98e22459fe3ac4b0d3e40437e5cdac9021175a2247937de369930b6db7ffa6eba0c24a46eed84c08d3999cc5f2cc46a6522be877cf4925ab0a78aa121e3f89a037c740ef7378e552fe63d4c2d5005f008982006b2f691385a311b35654d8f8cf56894801d08868c26b6a98243b6254df98bdec675877214b223a7f517d8e476dc78ac66b54e6dda42916f944a13e28e73bdba6243faa8fcf997cd514fdf6aa32d9c216be8d2449b27ce6d5bccc376a8ba8d2ad9a5ce6dc137d5fb0c05c3c98571661ccbbb584336c0cb1927cfdcec4a594354b8a66c65f1d36994212431dce73abaa6a9934b8ff7d08369d44ea85a5cb715575e74af18886d40b11f6ad9edbf62b81fcb09b3896be90e7673a912c870aa73f7f8262fae3888ef0213457354b1ccb1be2eb8ebc35b98f1ff5b6aeac813b14fd342058c59e733c72e520d35bcc41ebf5af06f6e6a8df1f0d62626fc1c2b34a8f092e7ac763d0ac205401f71c375155b0d544d8da90fba5b1bc3a798b58b86400583ad3abb753b5222631d41d3c07ab9a193ae4c876e9e5796674f15ea2e8ec9b125dca367c4c7f8cafbd4b5a488893054327bf0ff604181c58a65b684ca6e15addbd9e8ded3d4839b14d4d024495395b49dc88a8fbc70cbd12937dd5758698696843ba0516a0946c65678d3e675af86e3a73c4a2bd613f5b981da10cb7d68405dc9362316ef48"
    ],
    [
        "<< |updatesearch|{\"searching\":[],\"games\":null}"
    ],
    [
        "<< |updateuser| moxSedai|1|101|{\"blockChallenges\":false,\"blockPMs\":false,\"ignoreTickets\":false,\"hideBattlesFromTrainerCard\":false,\"blockInvites\":false,\"doNotDisturb\":false,\"blockFriendRequests\":false,\"allowFriendNotifications\":false,\"displayBattlesToFriends\":false,\"hideLogins\":false,\"hiddenNextBattle\":false,\"inviteOnlyNextBattle\":false,\"language\":null}"
    ],
    [
        "<< >othermetas\n|J| moxSedai"
    ],
    [
        ">> |/utm null"
    ],
    [
        "<< >othermetas\n|L| gamewolf378"
    ],
    [
        ">> |/search gen9randombattle"
    ],
    [
        "<< >othermetas\n|L| Docter_Peng99"
    ],
    [
        "<< |updatesearch|{\"searching\":[],\"games\":null}"
    ],
    [
        "<< |updatesearch|{\"searching\":[],\"games\":{\"battle-gen9randombattle-2251623436\":\"[Gen 9] Random Battle*\"}}"
    ],
    [
        "<< |updatesearch|{\"searching\":[],\"games\":{\"battle-gen9randombattle-2251623436\":\"[Gen 9] Random Battle*\"}}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|init|battle\n|title|moxSedai vs. Howock\n|j|☆moxSedai\n"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|j|☆Howock"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|t:|1732648092\n|gametype|singles"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|player|p1|moxSedai|101|1132"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":32,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":32,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"291/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"291/291\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":2}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|player|p2|Howock|skier|1093\n|teamsize|p1|6\n|teamsize|p2|6\n|gen|9\n|tier|[Gen 9] Random Battle\n|rated|\n|rule|Species Clause: Limit one of each Pokémon\n|rule|HP Percentage Mod: HP is shown in percentages\n|rule|Sleep Clause Mod: Limit one foe put to sleep\n|rule|Illusion Level Mod: Illusion disguises the Pokémon's true level\n|\n|t:|1732648092\n|start\n|switch|p1a: Jirachi|Jirachi, L80|291/291\n|switch|p2a: Virizion|Virizion, L82|100/100\n|turn|1"
    ],
    [
        "<< >othermetas\n|L| dragoon244"
    ],
    [
        "<< >othermetas\n|L| pikazard66"
    ],
    [
        "<< >othermetas\n|J| gamewolf378"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":808,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":308,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":476,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":33,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":42,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":43,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":212,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":75,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":541,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":19,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":90,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":279,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":38,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":37,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":132,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":112,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":440,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":81,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":125,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":29,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":58,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":410,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":18,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":203,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":37,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":55,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":38},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18108,\"battleCount\":3019}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|2"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"236/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"291/291\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":4}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648108\n|move|p2a: Virizion|Leaf Blade|p1a: Jirachi\n|-resisted|p1a: Jirachi\n|-damage|p1a: Jirachi|236/291\n|-damage|p2a: Virizion|91/100|[from] item: Life Orb\n|move|p1a: Jirachi|U-turn|p2a: Virizion\n|-damage|p2a: Virizion|70/100"
    ],
    [
        "<< >othermetas\n|J| ggvvyz"
    ],
    [
        "<< >othermetas\n|L| melmetal fanboy"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 2|4"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Blizzard\",\"id\":\"blizzard\",\"pp\":8,\"maxpp\":8,\"target\":\"allAdjacentFoes\",\"disabled\":false},{\"move\":\"Ice Shard\",\"id\":\"iceshard\",\"pp\":48,\"maxpp\":48,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Aurora Veil\",\"id\":\"auroraveil\",\"pp\":32,\"maxpp\":32,\"target\":\"allySide\",\"disabled\":false},{\"move\":\"Earthquake\",\"id\":\"earthquake\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false}],\"canTerastallize\":\"Ice\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"291/291\",\"active\":true,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"236/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":6}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648120\n|switch|p1a: Abomasnow|Abomasnow, L85, F|291/291|[from] U-turn\n|-weather|Snow|[from] ability: Snow Warning|[of] p1a: Abomasnow\n|\n|-weather|Snow|[upkeep]\n|upkeep\n|turn|2"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":809,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":309,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":474,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":42,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":43,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":15,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":212,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":540,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":91,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":276,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":38,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":33,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":36,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":131,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":113,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":443,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":38,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":79,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":124,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":29,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":412,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":18,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":204,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":37,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":54,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18122,\"battleCount\":3015}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 2|6"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Blizzard\",\"id\":\"blizzard\",\"pp\":8,\"maxpp\":8,\"target\":\"allAdjacentFoes\",\"disabled\":false},{\"move\":\"Ice Shard\",\"id\":\"iceshard\",\"pp\":47,\"maxpp\":48,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Aurora Veil\",\"id\":\"auroraveil\",\"pp\":32,\"maxpp\":32,\"target\":\"allySide\",\"disabled\":false},{\"move\":\"Earthquake\",\"id\":\"earthquake\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false}],\"canTerastallize\":\"Ice\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"158/291\",\"active\":true,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"236/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":8}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648132\n|move|p1a: Abomasnow|Ice Shard|p2a: Virizion\n|-supereffective|p2a: Virizion\n|-damage|p2a: Virizion|34/100\n|move|p2a: Virizion|Stone Edge|p1a: Abomasnow\n|-supereffective|p1a: Abomasnow\n|-damage|p1a: Abomasnow|158/291\n|-damage|p2a: Virizion|24/100|[from] item: Life Orb\n|\n|-weather|Snow|[upkeep]\n|upkeep\n|turn|3"
    ],
    [
        "<< >othermetas\n|L| jerryfan"
    ],
    [
        "<< >othermetas\n|J| Metronome is good"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 3|8"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":811,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":310,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":473,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":46,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":46,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":14,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":211,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":540,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":80,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":278,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":39,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":32,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":38,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":132,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":114,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":437,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":38,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":407,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":18,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":204,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":36,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":54,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18092,\"battleCount\":3018}"
    ],
    [
        "<< >othermetas\n|L| Aoryuu 1-5"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":true,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"236/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":10}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648146\n|move|p2a: Virizion|Close Combat|p1a: Abomasnow\n|-supereffective|p1a: Abomasnow\n|-damage|p1a: Abomasnow|0 fnt\n|-unboost|p2a: Virizion|def|1\n|-unboost|p2a: Virizion|spd|1\n|faint|p1a: Abomasnow\n|-damage|p2a: Virizion|14/100|[from] item: Life Orb\n|\n|-weather|Snow|[upkeep]\n|upkeep"
    ],
    [
        "<< >othermetas\n|J| JudgeJudith"
    ],
    [
        "<< >othermetas\n|L| Crysantimo"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 2|10"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":32,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":31,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"236/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":12}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648155\n|switch|p1a: Jirachi|Jirachi, L80|236/291\n|turn|4"
    ],
    [
        "<< >othermetas\n|L| HGPL KINZO"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 2|12"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":811,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":312,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":472,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":46,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":14,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":197,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":536,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":80,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":70,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":91,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":276,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":39,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":33,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":33,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":38,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":131,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":113,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":438,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":406,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":23,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":206,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":54,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":42,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18090,\"battleCount\":2985}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":31,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":14}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648177\n|switch|p2a: Brute Bonnet|Brute Bonnet, L81|100/100\n|move|p1a: Jirachi|Stealth Rock|p2a: Brute Bonnet\n|-sidestart|p2: Howock|move: Stealth Rock\n|\n|-weather|Snow|[upkeep]\n|-heal|p1a: Jirachi|254/291|[from] item: Leftovers\n|upkeep\n|turn|5"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":812,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":312,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":473,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":14,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":65,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":197,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":539,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":78,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":21,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":91,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":276,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":40,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":32,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":33,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":37,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":131,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":113,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":435,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":127,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":411,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":23,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":37},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":42,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18085,\"battleCount\":3006}"
    ],
    [
        "<< >othermetas\n|J| I gonna die"
    ],
    [
        "<< >othermetas\n|J| zpxq"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|14"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"258/258\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":16}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648192\n|move|p1a: Jirachi|U-turn|p2a: Brute Bonnet\n|-supereffective|p2a: Brute Bonnet\n|-damage|p2a: Brute Bonnet|39/100"
    ],
    [
        "<< >othermetas\n|J| Docter_Peng99"
    ],
    [
        "<< >othermetas\n|L| ggvvyz"
    ],
    [
        "<< >othermetas\n|L| Bjjkidcade"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":807,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":308,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":472,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":45,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":14,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":204,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":72,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":198,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":535,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":78,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":21,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":90,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":278,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":38,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":33,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":33,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":36,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":128,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":114,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":434,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":78,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":128,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":29,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":409,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":38,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":37,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":29,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":42,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18065,\"battleCount\":3001}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 5|16"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Knock Off\",\"id\":\"knockoff\",\"pp\":32,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Double-Edge\",\"id\":\"doubleedge\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Leaf Blade\",\"id\":\"leafblade\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Swords Dance\",\"id\":\"swordsdance\",\"pp\":32,\"maxpp\":32,\"target\":\"self\",\"disabled\":false}],\"canTerastallize\":\"Normal\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"147/258\",\"active\":true,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":18}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648207\n|switch|p1a: Leafeon|Leafeon, L88, F|258/258|[from] U-turn\n|move|p2a: Brute Bonnet|Crunch|p1a: Leafeon\n|-crit|p1a: Leafeon\n|-damage|p1a: Leafeon|147/258\n|\n|-weather|none\n|-heal|p2a: Brute Bonnet|45/100|[from] item: Leftovers\n|upkeep\n|turn|6"
    ],
    [
        "<< >othermetas\n|L| Overlorden98"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|18"
    ],
    [
        "<< >othermetas\n|J| CynthiaVC5"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Knock Off\",\"id\":\"knockoff\",\"pp\":31,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Double-Edge\",\"id\":\"doubleedge\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Leaf Blade\",\"id\":\"leafblade\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Swords Dance\",\"id\":\"swordsdance\",\"pp\":32,\"maxpp\":32,\"target\":\"self\",\"disabled\":false}],\"canTerastallize\":\"Normal\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"67/258\",\"active\":true,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":20}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648223\n|move|p2a: Brute Bonnet|Sucker Punch|p1a: Leafeon\n|-damage|p1a: Leafeon|92/258\n|move|p1a: Leafeon|Knock Off|p2a: Brute Bonnet\n|-resisted|p2a: Brute Bonnet\n|-damage|p2a: Brute Bonnet|28/100\n|-enditem|p2a: Brute Bonnet|Leftovers|[from] move: Knock Off|[of] p1a: Leafeon\n|-damage|p1a: Leafeon|67/258|[from] item: Life Orb\n|\n|upkeep\n|turn|7"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":810,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":309,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":472,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":57,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":45,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":14,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":205,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":21,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":73,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":198,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":541,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":92,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":278,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":38,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":33,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":38,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":129,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":115,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":435,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":78,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":129,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":413,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":38,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":38,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":42,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18048,\"battleCount\":2992}"
    ],
    [
        "<< >othermetas\n|L| Dafijis"
    ],
    [
        "<< >othermetas\n|L| Ren"
    ],
    [
        "<< >othermetas\n|J| lols/bolt strika"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|20"
    ],
    [
        "<< >othermetas\n|L| Shoko12"
    ],
    [
        "<< >othermetas\n|L| rerrs"
    ],
    [
        "<< >othermetas\n|J| Bjjkidcade"
    ],
    [
        "<< >othermetas\n|L| Maximus027"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Knock Off\",\"id\":\"knockoff\",\"pp\":31,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Double-Edge\",\"id\":\"doubleedge\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Leaf Blade\",\"id\":\"leafblade\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Swords Dance\",\"id\":\"swordsdance\",\"pp\":31,\"maxpp\":32,\"target\":\"self\",\"disabled\":false}],\"canTerastallize\":\"Normal\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"67/258\",\"active\":true,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"rqid\":22}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648242\n|move|p2a: Brute Bonnet|Sucker Punch||[still]\n|-fail|p2a: Brute Bonnet\n|move|p1a: Leafeon|Swords Dance|p1a: Leafeon\n|-boost|p1a: Leafeon|atk|2\n|\n|upkeep\n|turn|8"
    ],
    [
        "<< >othermetas\n|J| ccyberstyle"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":812,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":307,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":472,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":57,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":46,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":15,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":205,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":21,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":197,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":544,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":21,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":37,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":64,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":132,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":117,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":435,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":79,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":129,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":411,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":13,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":22,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":42,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18068,\"battleCount\":3014}"
    ],
    [
        "<< >othermetas\n|L| I gonna die"
    ],
    [
        "<< >othermetas\n|J| Kinetic"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|22"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":true,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":24}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648254\n|move|p2a: Brute Bonnet|Sucker Punch|p1a: Leafeon\n|-damage|p1a: Leafeon|10/258\n|move|p1a: Leafeon|Knock Off|p2a: Brute Bonnet\n|-resisted|p2a: Brute Bonnet\n|-damage|p2a: Brute Bonnet|6/100\n|-damage|p1a: Leafeon|0 fnt|[from] item: Life Orb\n|faint|p1a: Leafeon\n|\n|upkeep"
    ],
    [
        "<< >othermetas\n|J| King Wowowood"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":816,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":308,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":471,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":45,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":206,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":22,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":198,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":539,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":21,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":69,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":95,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":37,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":65,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":131,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":118,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":431,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":81,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":129,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":413,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18090,\"battleCount\":2972}"
    ],
    [
        "<< >othermetas\n|L| Maxifario"
    ],
    [
        "<< >othermetas\n|J| BoeBama"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 6|24"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Toxic Spikes\",\"id\":\"toxicspikes\",\"pp\":32,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Fiery Dance\",\"id\":\"fierydance\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Sludge Wave\",\"id\":\"sludgewave\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false},{\"move\":\"Energy Ball\",\"id\":\"energyball\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Grass\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":26}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648267\n|switch|p1a: Iron Moth|Iron Moth, L78|253/253\n|turn|9"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|26"
    ],
    [
        "<< >othermetas\n|J| AstilCodex"
    ],
    [
        "<< >othermetas\n|J|‽trolilouvgc"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":817,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":311,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":472,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":36,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":44,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":206,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":78,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":200,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":541,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":80,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":20,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":70,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":96,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":283,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":37,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":38,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":131,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":119,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":430,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":82,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":63,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":128,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":28,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":61,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":422,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":14},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":211,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":30,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18079,\"battleCount\":2950}"
    ],
    [
        "<< >othermetas\n|L| SergioRules"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Toxic Spikes\",\"id\":\"toxicspikes\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Fiery Dance\",\"id\":\"fierydance\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Sludge Wave\",\"id\":\"sludgewave\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false},{\"move\":\"Energy Ball\",\"id\":\"energyball\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Grass\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":28}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648285\n|move|p2a: Brute Bonnet|Sucker Punch||[still]\n|-fail|p2a: Brute Bonnet\n|move|p1a: Iron Moth|Toxic Spikes|p2a: Brute Bonnet\n|-sidestart|p2: Howock|move: Toxic Spikes\n|\n|upkeep\n|turn|10"
    ],
    [
        "<< >othermetas\n|L|‽trolilouvgc"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|28"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Toxic Spikes\",\"id\":\"toxicspikes\",\"pp\":30,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Fiery Dance\",\"id\":\"fierydance\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Sludge Wave\",\"id\":\"sludgewave\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false},{\"move\":\"Energy Ball\",\"id\":\"energyball\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Grass\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"253/253\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":30}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648289\n|move|p2a: Brute Bonnet|Sucker Punch||[still]\n|-fail|p2a: Brute Bonnet\n|move|p1a: Iron Moth|Toxic Spikes|p2a: Brute Bonnet\n|-sidestart|p2: Howock|move: Toxic Spikes\n|\n|upkeep\n|turn|11"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 2|30"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"wait\":true,\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"61/253\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":32}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648297\n|move|p2a: Brute Bonnet|Sucker Punch|p1a: Iron Moth\n|-crit|p1a: Iron Moth\n|-damage|p1a: Iron Moth|61/253\n|move|p1a: Iron Moth|Fiery Dance|p2a: Brute Bonnet\n|-supereffective|p2a: Brute Bonnet\n|-damage|p2a: Brute Bonnet|0 fnt\n|faint|p2a: Brute Bonnet\n|-end|p2a: Brute Bonnet|Protosynthesis|[silent]\n|\n|upkeep"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":820,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":314,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":469,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":44,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":207,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":77,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":542,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":18,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":69,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":96,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":282,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":120,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":432,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":83,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":63,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":128,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":27,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":61,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":422,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":210,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":53,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18097,\"battleCount\":2951}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Toxic Spikes\",\"id\":\"toxicspikes\",\"pp\":30,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Fiery Dance\",\"id\":\"fierydance\",\"pp\":15,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Sludge Wave\",\"id\":\"sludgewave\",\"pp\":16,\"maxpp\":16,\"target\":\"allAdjacent\",\"disabled\":false},{\"move\":\"Energy Ball\",\"id\":\"energyball\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Grass\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"61/253\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":34}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648304\n|switch|p2a: Cramorant|Cramorant, L86, F|100/100\n|turn|12"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|34"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":true,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":36}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648315\n|move|p1a: Iron Moth|Energy Ball|p2a: Cramorant\n|-damage|p2a: Cramorant|72/100\n|move|p2a: Cramorant|Surf|p1a: Iron Moth\n|-formechange|p2a: Cramorant|Cramorant-Gulping|\n|-supereffective|p1a: Iron Moth\n|-damage|p1a: Iron Moth|0 fnt\n|faint|p1a: Iron Moth\n|-end|p1a: Iron Moth|Quark Drive|[silent]\n|\n|upkeep"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":824,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":316,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":470,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":45,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":34,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":9,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":207,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":544,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":80,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":96,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":280,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":35,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":129,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":120,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":432,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":84,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":62,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":127,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":27,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":62,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":418,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":212,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":52,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18057,\"battleCount\":2947}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 3|36"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Brave Bird\",\"id\":\"bravebird\",\"pp\":5,\"maxpp\":5,\"target\":\"any\",\"disabled\":false},{\"move\":\"Defog\",\"id\":\"defog\",\"pp\":5,\"maxpp\":5,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Roost\",\"id\":\"roost\",\"pp\":5,\"maxpp\":5,\"target\":\"self\",\"disabled\":false},{\"move\":\"Surf\",\"id\":\"surf\",\"pp\":5,\"maxpp\":5,\"target\":\"allAdjacent\",\"disabled\":false}],\"canTerastallize\":\"Dragon\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"225/225\",\"active\":true,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"bravebird\",\"defog\",\"roost\",\"surf\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"gulpmissile\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":38}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648330\n|switch|p1a: Ditto|Ditto, L87|225/225\n|-transform|p1a: Ditto|p2a: Cramorant|[from] ability: Imposter\n|turn|13"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|38"
    ],
    [
        "<< >othermetas\n|L| banthatworm2"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":825,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":315,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":463,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":41,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":16,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":11,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":75,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":199,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":543,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":15,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":95,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":280,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":81,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":128,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":121,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":432,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":84,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":63,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":127,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":61,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":413,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":34,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":52,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18058,\"battleCount\":2937}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Brave Bird\",\"id\":\"bravebird\",\"pp\":4,\"maxpp\":5,\"target\":\"any\",\"disabled\":false},{\"move\":\"Defog\",\"id\":\"defog\",\"pp\":5,\"maxpp\":5,\"target\":\"normal\",\"disabled\":true},{\"move\":\"Roost\",\"id\":\"roost\",\"pp\":5,\"maxpp\":5,\"target\":\"self\",\"disabled\":true},{\"move\":\"Surf\",\"id\":\"surf\",\"pp\":5,\"maxpp\":5,\"target\":\"allAdjacent\",\"disabled\":true}],\"canTerastallize\":\"Dragon\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"118/225\",\"active\":true,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"bravebird\",\"defog\",\"roost\",\"surf\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"gulpmissile\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":40}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648346\n|move|p1a: Ditto|Brave Bird|p2a: Cramorant\n|-damage|p2a: Cramorant|13/100\n|-damage|p1a: Ditto|169/225|[from] ability: Gulp Missile|[of] p2a: Cramorant\n|-unboost|p1a: Ditto|def|1\n|-formechange|p2a: Cramorant|Cramorant|\n|-damage|p1a: Ditto|118/225|[from] Recoil\n|move|p2a: Cramorant|Roost|p2a: Cramorant\n|-heal|p2a: Cramorant|63/100\n|-singleturn|p2a: Cramorant|move: Roost\n|\n|upkeep\n|turn|14"
    ],
    [
        "<< >othermetas\n|L| danielgheorghe200"
    ],
    [
        "<< >othermetas\n|L| lols/bolt strika"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|40"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":true,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":42}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648361\n|move|p1a: Ditto|Brave Bird|p2a: Cramorant\n|-damage|p2a: Cramorant|1/100\n|-damage|p1a: Ditto|65/225|[from] Recoil\n|move|p2a: Cramorant|Brave Bird|p1a: Ditto\n|-damage|p1a: Ditto|0 fnt\n|faint|p1a: Ditto\n|-damage|p2a: Cramorant|0 fnt|[from] Recoil\n|faint|p2a: Cramorant\n|\n|upkeep"
    ],
    [
        "<< >othermetas\n|L| zezaktest"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":825,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":312,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":463,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":19,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":11,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":210,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":75,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":196,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":545,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":15,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":95,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":280,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":128,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":121,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":431,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":84,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":63,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":127,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":414,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":38,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":34,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":51,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":43,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18071,\"battleCount\":2927}"
    ],
    [
        "<< >othermetas\n|J| TroolyGhoulie"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 4|42"
    ],
    [
        "<< >othermetas\n|L| Bjjkidcade"
    ],
    [
        "<< >othermetas\n|L| elinix"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Psyshock\",\"id\":\"psyshock\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Fire Blast\",\"id\":\"fireblast\",\"pp\":8,\"maxpp\":8,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Thunderbolt\",\"id\":\"thunderbolt\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Nasty Plot\",\"id\":\"nastyplot\",\"pp\":32,\"maxpp\":32,\"target\":\"self\",\"disabled\":false}],\"canTerastallize\":\"Psychic\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"257/257\",\"active\":true,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":44}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648376\n|switch|p2a: Mimikyu|Mimikyu, L79, F|100/100\n|switch|p1a: Azelf|Azelf, L82|257/257\n|-damage|p2a: Mimikyu|88/100|[from] Stealth Rock\n|-status|p2a: Mimikyu|tox\n|turn|15"
    ],
    [
        "<< >othermetas\n|c:|1732648382| indigo ketchup|what if they were in"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":830,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":311,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":463,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":43,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":18,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":74,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":195,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":548,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":79,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":16,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":94,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":36,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":127,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":122,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":433,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":83,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":62,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":127,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":27,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":413,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":29,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":38,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":16},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":34,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":51,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":46,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18052,\"battleCount\":2910}"
    ],
    [
        "<< >othermetas\n|J| Bjjkidcade"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|44"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Psyshock\",\"id\":\"psyshock\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Fire Blast\",\"id\":\"fireblast\",\"pp\":8,\"maxpp\":8,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Thunderbolt\",\"id\":\"thunderbolt\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Nasty Plot\",\"id\":\"nastyplot\",\"pp\":31,\"maxpp\":32,\"target\":\"self\",\"disabled\":false}],\"canTerastallize\":\"Psychic\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"131/257\",\"active\":true,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":46}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648392\n|move|p1a: Azelf|Nasty Plot|p1a: Azelf\n|-boost|p1a: Azelf|spa|2\n|move|p2a: Mimikyu|Play Rough|p1a: Azelf\n|-damage|p1a: Azelf|131/257\n|-damage|p2a: Mimikyu|78/100 tox|[from] item: Life Orb\n|\n|-damage|p2a: Mimikyu|72/100 tox|[from] psn\n|upkeep\n|turn|16"
    ],
    [
        "<< >othermetas\n|L| Infinitanswers"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":831,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":313,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":463,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":43,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":196,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":550,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":16,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":94,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":286,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":36,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":39,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":128,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":123,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":431,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":82,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":63,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":125,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":27,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":414,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":50,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":31,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":47,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18053,\"battleCount\":2914}"
    ],
    [
        "<< >othermetas\n|J| DuckletonThe3rd"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 3|46"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"forceSwitch\":[true],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":true,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":false,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"noCancel\":true,\"rqid\":48}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648410\n|move|p2a: Mimikyu|Shadow Sneak|p1a: Azelf\n|-supereffective|p1a: Azelf\n|-damage|p1a: Azelf|22/257\n|-damage|p2a: Mimikyu|63/100 tox|[from] item: Life Orb\n|move|p1a: Azelf|Thunderbolt|p2a: Mimikyu\n|-activate|p2a: Mimikyu|ability: Disguise\n|-damage|p2a: Mimikyu|63/100 tox\n|detailschange|p2a: Mimikyu|Mimikyu-Busted, L79, F\n|-damage|p2a: Mimikyu|50/100 tox|[from] pokemon: Mimikyu-Busted\n|-damage|p1a: Azelf|0 fnt|[from] item: Life Orb\n|faint|p1a: Azelf\n|\n|-damage|p2a: Mimikyu|38/100 tox|[from] psn\n|upkeep"
    ],
    [
        "<< >othermetas\n|L| aidan amoongus"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose switch 5|48"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":24,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"254/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":50}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648422\n|switch|p1a: Jirachi|Jirachi, L80|254/291\n|turn|17"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":830,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":316,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":462,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":43,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":35,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":33,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":210,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":196,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":551,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":77,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":285,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":40,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":128,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":125,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":433,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":81,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":417,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":40,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":21,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":211,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":50,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":47,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18048,\"battleCount\":2905}"
    ],
    [
        "<< >othermetas\n|L| BoeBama"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|50"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"wait\":true,\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"272/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":52}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648433\n|move|p1a: Jirachi|Iron Head|p2a: Mimikyu\n|-supereffective|p2a: Mimikyu\n|-damage|p2a: Mimikyu|0 fnt\n|faint|p2a: Mimikyu\n|\n|-heal|p1a: Jirachi|272/291|[from] item: Leftovers\n|upkeep"
    ],
    [
        "<< >othermetas\n|L| ones1ngleplayer"
    ],
    [
        "<< >othermetas\n|c:|1732648435| Slothy0wl|They would work exactly how it normally does"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":23,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":16,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"272/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":54}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648439\n|switch|p2a: Porygon-Z|Porygon-Z, L83|100/100\n|-damage|p2a: Porygon-Z|88/100|[from] Stealth Rock\n|-status|p2a: Porygon-Z|tox\n|-ability|p2a: Porygon-Z|Download|boost\n|-boost|p2a: Porygon-Z|spa|1\n|turn|18"
    ],
    [
        "<< >othermetas\n|J| danielgheorghe200"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":839,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":317,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":467,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":34,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":39,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":10,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":210,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":195,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":552,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":284,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":30,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":40,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":122,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":433,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":81,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":125,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":27,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":60,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":417,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":41,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":211,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":50,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":16,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":23,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":48,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18062,\"battleCount\":2906}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 3|54"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":23,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":15,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"148/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":56}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648451\n|move|p1a: Jirachi|Drain Punch|p2a: Porygon-Z\n|-supereffective|p2a: Porygon-Z\n|-damage|p2a: Porygon-Z|45/100 tox\n|-heal|p1a: Jirachi|291/291|[from] drain|[of] p2a: Porygon-Z\n|move|p2a: Porygon-Z|Thunderbolt|p1a: Jirachi\n|-damage|p1a: Jirachi|130/291\n|-damage|p2a: Porygon-Z|35/100 tox|[from] item: Life Orb\n|\n|-heal|p1a: Jirachi|148/291|[from] item: Leftovers\n|-damage|p2a: Porygon-Z|29/100 tox|[from] psn\n|upkeep\n|turn|19"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 3|56"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":834,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":320,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":463,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":47,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":32,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":11,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":211,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":24,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":195,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":548,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":77,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":40,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":61,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":120,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":437,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":40,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":81,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":58,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":414,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":24,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":42,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":209,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":35,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":50,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":39,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":46,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18043,\"battleCount\":2891}"
    ],
    [
        "<< >othermetas\n|J| wseymour29"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"wait\":true,\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"206/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":58}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648467\n|move|p1a: Jirachi|Drain Punch|p2a: Porygon-Z\n|-supereffective|p2a: Porygon-Z\n|-damage|p2a: Porygon-Z|0 fnt\n|-heal|p1a: Jirachi|188/291|[from] drain|[of] p2a: Porygon-Z\n|faint|p2a: Porygon-Z\n|\n|-heal|p1a: Jirachi|206/291|[from] item: Leftovers\n|upkeep"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":23,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"206/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"leftovers\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":60}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648475\n|switch|p2a: Spidops|Spidops, L96, M|100/100\n|turn|20"
    ],
    [
        "<< >othermetas\n|J| ikagura725792489"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":835,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":318,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":469,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":57,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":48,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":31,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":11,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":55,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":60,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":212,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":24,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":196,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":548,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":281,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":9,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":32,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":42,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":122,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":435,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":124,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":58,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":415,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":41,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":207,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":36,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":48,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":40,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":32,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":24,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":46,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18037,\"battleCount\":2914}"
    ],
    [
        "<< >othermetas\n|L| apateonas"
    ],
    [
        "<< >othermetas\n|L| ikagura725792489"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|60"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":22,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":62}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648500\n|move|p1a: Jirachi|Iron Head|p2a: Spidops\n|-damage|p2a: Spidops|77/100\n|move|p2a: Spidops|Knock Off|p1a: Jirachi\n|-supereffective|p1a: Jirachi\n|-damage|p1a: Jirachi|70/291\n|-enditem|p1a: Jirachi|Leftovers|[from] move: Knock Off|[of] p2a: Spidops\n|\n|upkeep\n|turn|21"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":827,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":318,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":468,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":105,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":48,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":30,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":11,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":59,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":214,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":24,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":78,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":196,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":549,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":95,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":280,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":85,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":42,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":123,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":436,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":80,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":65,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":124,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":59,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":415,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":28,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":12,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":36,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":47,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":41,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":33,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":35},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":25,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":46,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18018,\"battleCount\":2888}"
    ],
    [
        "<< >othermetas\n|J|‽The Dark Kelpie"
    ],
    [
        "<< >othermetas\n|N|‽The Dark Kelpie|thedarkkelpie"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|62"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":21,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}],\"canTerastallize\":\"Fighting\"}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":64}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648513\n|move|p1a: Jirachi|Iron Head|p2a: Spidops\n|-damage|p2a: Spidops|52/100\n|cant|p2a: Spidops|flinch\n|\n|upkeep\n|turn|22"
    ],
    [
        "<< >othermetas\n|L| JeanPierre693"
    ],
    [
        "<< >othermetas\n|L| Bjjkidcade"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":828,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":318,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":467,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":30,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":48,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":30,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":12,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":58,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":214,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":23,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":75,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":194,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":550,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":16,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":64,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":92,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":282,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":35,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":53,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":41,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":130,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":122,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":438,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":78,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":124,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":57,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":414,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":27,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":38,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":38,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":23,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":11,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":34,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":47,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":41,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":33,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":25,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":45,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18048,\"battleCount\":2874}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1 terastallize|64"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":20,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}]}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"Fighting\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":66}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648526\n|-terastallize|p1a: Jirachi|Fighting\n|move|p1a: Jirachi|Iron Head|p2a: Spidops\n|-damage|p2a: Spidops|26/100\n|cant|p2a: Spidops|flinch\n|\n|upkeep\n|turn|23"
    ],
    [
        "<< >othermetas\n|J| Bjjkidcade"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|66"
    ],
    [
        "<< >othermetas\n|J| FRED12101013"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":19,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}]}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"Fighting\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":68}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648537\n|move|p1a: Jirachi|Iron Head|p2a: Spidops\n|-damage|p2a: Spidops|2/100\n|cant|p2a: Spidops|flinch\n|\n|upkeep\n|turn|24"
    ],
    [
        "<< >othermetas\n|N| odottt1078@!|odottt1078"
    ],
    [
        "<< >othermetas\n|N| Morpekosmos@!|morpekosmos"
    ],
    [
        "<< >othermetas\n|N| Gyltia@!|gyltia"
    ],
    [
        "<< >othermetas\n|N| golypoly@!|golypoly"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 1|68"
    ],
    [
        "<< >othermetas\n|L| avarara"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":833,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":318,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":471,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":29,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":45,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":32,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":107,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":48,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":30,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":13,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":58,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":213,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":24,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":76,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":194,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":551,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":75,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":16,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":93,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":285,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":35,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":52,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":35,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":82,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":41,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":133,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":123,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":438,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":26,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":79,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":66,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":124,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":25,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":56,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":410,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":16,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":27,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":11,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":206,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":34,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":46,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":41,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":33,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":32,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":25,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18096,\"battleCount\":2902}"
    ],
    [
        ">> battle-gen9randombattle-2251623436|im so sorry"
    ],
    [
        "<< >othermetas\n|J|+Tone"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|c|☆moxSedai|im so sorry"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"wait\":true,\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"Fighting\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":70}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648549\n|move|p1a: Jirachi|Iron Head|p2a: Spidops\n|-damage|p2a: Spidops|0 fnt\n|faint|p2a: Spidops\n|\n|upkeep"
    ],
    [
        "<< >othermetas\n|J| Anna says hi"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|request|{\"active\":[{\"moves\":[{\"move\":\"Iron Head\",\"id\":\"ironhead\",\"pp\":18,\"maxpp\":24,\"target\":\"normal\",\"disabled\":false},{\"move\":\"Stealth Rock\",\"id\":\"stealthrock\",\"pp\":31,\"maxpp\":32,\"target\":\"foeSide\",\"disabled\":false},{\"move\":\"Drain Punch\",\"id\":\"drainpunch\",\"pp\":14,\"maxpp\":16,\"target\":\"normal\",\"disabled\":false},{\"move\":\"U-turn\",\"id\":\"uturn\",\"pp\":30,\"maxpp\":32,\"target\":\"normal\",\"disabled\":false}]}],\"side\":{\"name\":\"moxSedai\",\"id\":\"p1\",\"pokemon\":[{\"ident\":\"p1: Jirachi\",\"details\":\"Jirachi, L80\",\"condition\":\"70/291\",\"active\":true,\"stats\":{\"atk\":206,\"def\":206,\"spa\":206,\"spd\":206,\"spe\":206},\"moves\":[\"ironhead\",\"stealthrock\",\"drainpunch\",\"uturn\"],\"baseAbility\":\"serenegrace\",\"item\":\"\",\"pokeball\":\"pokeball\",\"ability\":\"serenegrace\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Fighting\",\"terastallized\":\"Fighting\"},{\"ident\":\"p1: Abomasnow\",\"details\":\"Abomasnow, L85, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":205,\"def\":176,\"spa\":205,\"spd\":193,\"spe\":151},\"moves\":[\"blizzard\",\"iceshard\",\"auroraveil\",\"earthquake\"],\"baseAbility\":\"snowwarning\",\"item\":\"lightclay\",\"pokeball\":\"pokeball\",\"ability\":\"snowwarning\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Ice\",\"terastallized\":\"\"},{\"ident\":\"p1: Iron Moth\",\"details\":\"Iron Moth, L78\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":114,\"def\":139,\"spa\":263,\"spd\":217,\"spe\":217},\"moves\":[\"toxicspikes\",\"fierydance\",\"sludgewave\",\"energyball\"],\"baseAbility\":\"quarkdrive\",\"item\":\"heavydutyboots\",\"pokeball\":\"pokeball\",\"ability\":\"quarkdrive\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Grass\",\"terastallized\":\"\"},{\"ident\":\"p1: Ditto\",\"details\":\"Ditto, L87\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":133,\"def\":133,\"spa\":133,\"spd\":133,\"spe\":133},\"moves\":[\"transform\"],\"baseAbility\":\"imposter\",\"item\":\"choicescarf\",\"pokeball\":\"pokeball\",\"ability\":\"imposter\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Dragon\",\"terastallized\":\"\"},{\"ident\":\"p1: Azelf\",\"details\":\"Azelf, L82\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":210,\"def\":162,\"spa\":252,\"spd\":162,\"spe\":236},\"moves\":[\"psyshock\",\"fireblast\",\"thunderbolt\",\"nastyplot\"],\"baseAbility\":\"levitate\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"levitate\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Psychic\",\"terastallized\":\"\"},{\"ident\":\"p1: Leafeon\",\"details\":\"Leafeon, L88, F\",\"condition\":\"0 fnt\",\"active\":false,\"stats\":{\"atk\":244,\"def\":279,\"spa\":156,\"spd\":165,\"spe\":217},\"moves\":[\"knockoff\",\"doubleedge\",\"leafblade\",\"swordsdance\"],\"baseAbility\":\"chlorophyll\",\"item\":\"lifeorb\",\"pokeball\":\"pokeball\",\"ability\":\"chlorophyll\",\"commanding\":false,\"reviving\":false,\"teraType\":\"Normal\",\"terastallized\":\"\"}]},\"rqid\":72}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648553\n|switch|p2a: Virizion|Virizion, L82|14/100\n|-damage|p2a: Virizion|8/100|[from] Stealth Rock\n|-status|p2a: Virizion|tox\n|turn|25"
    ],
    [
        "<< >othermetas\n|J| ikagura725792489"
    ],
    [
        ">> battle-gen9randombattle-2251623436|/choose move 4|72"
    ],
    [
        "<< >othermetas\n|J| Briefyking"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":832,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":317,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":475,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":29,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":33,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":48,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":30,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":12,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":56,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":58,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":213,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":25,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":77,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":197,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":555,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":75,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":17,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":94,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":291,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":35,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":31,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":41,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":62,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":134,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":124,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":439,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":27,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":79,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":125,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":56,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":413,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":26,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":21,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":11,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":206,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":33,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":47,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":41,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":33,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":33,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":17,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":25,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":44,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18109,\"battleCount\":2923}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|\n|t:|1732648569\n|move|p2a: Virizion|Close Combat|p1a: Jirachi\n|-damage|p1a: Jirachi|0 fnt\n|-unboost|p2a: Virizion|def|1\n|-unboost|p2a: Virizion|spd|1\n|faint|p1a: Jirachi\n|-damage|p2a: Virizion|0 fnt|[from] item: Life Orb\n|faint|p2a: Virizion\n|\n|win|Howock"
    ],
    [
        "<< |updatesearch|{\"searching\":[],\"games\":null}"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|raw|moxSedai's rating: 1132 &rarr; <strong>1104</strong><br />(-28 for losing)\n|raw|Howock's rating: 1093 &rarr; <strong>1122</strong><br />(+29 for winning)"
    ],
    [
        ">> battle-gen9randombattle-2251623436|gg"
    ],
    [
        "<< >battle-gen9randombattle-2251623436\n|c|☆moxSedai|gg"
    ],
    [
        "<< >othermetas\n|L| ilikeplayingroblox"
    ],
    [
        "<< >othermetas\n|J| ToxicAltaria72"
    ],
    [
        ">> |/cmd rooms"
    ],
    [
        "<< |queryresponse|rooms|{\"chat\":[{\"title\":\"Lobby\",\"desc\":\"Still haven't decided on a room for you? Relax here amidst the chaos.\",\"userCount\":831,\"section\":\"Official\"},{\"title\":\"Help\",\"desc\":\"Have a question about Showdown or Smogon? We'd be glad to help you out!\",\"userCount\":319,\"section\":\"Official\"},{\"title\":\"Tournaments\",\"desc\":\"24/7 room tournaments! Join and ascend the leaderboard :P\",\"userCount\":481,\"section\":\"Official\",\"subRooms\":[\"Tours Plaza\",\"Tours Minigames\"]},{\"title\":\"Smash Bros\",\"desc\":\"The go-to hub for all things Smash, for casual and competitive players alike!\",\"userCount\":24,\"section\":\"Gaming\"},{\"title\":\"Anything Goes\",\"desc\":\"The Ubers of Ubers\",\"userCount\":59,\"section\":\"Battle formats\"},{\"title\":\"Battle Dome\",\"desc\":\"A text-based RPG, with weapons, classes, and magic galore!\",\"userCount\":29,\"section\":\"On-site games\"},{\"title\":\"CAP Project\",\"desc\":\"Join us to discuss the Create-A-Pokémon Project and Metagame!\",\"userCount\":44,\"section\":\"Battle formats\"},{\"title\":\"中文 Chinese\",\"desc\":\"欢迎来自世界各地的中文玩家\",\"userCount\":32,\"section\":\"Languages\"},{\"title\":\"Deutsche\",\"desc\":\"Der Raum der deutschen Community auf PS!\",\"userCount\":40,\"section\":\"Languages\"},{\"title\":\"Français\",\"desc\":\"Là où les Dresseurs transforment leurs rêves en réalités!\",\"userCount\":106,\"section\":\"Languages\",\"subRooms\":[\"Arcade\"]},{\"title\":\"Game Corner\",\"desc\":\"Play games and bet responsibly. No coin case needed.\",\"userCount\":49,\"section\":\"On-site games\"},{\"title\":\"Health & Fitness\",\"desc\":\"Share advice, seek help or look for motivation from others.\",\"userCount\":17,\"section\":\"Life & hobbies\"},{\"title\":\"Italiano\",\"desc\":\"La room che move il sole e l'altre stelle.\",\"userCount\":31,\"section\":\"Languages\",\"subRooms\":[\"TEAMBALLO IV\"]},{\"title\":\"日本語 Japanese\",\"desc\":\"日本語で会話したい方はこちらへ！\",\"userCount\":12,\"section\":\"Languages\"},{\"title\":\"Little Cup\",\"desc\":\"As dangerous as cute! Try out our tier comprised of baby Pokémon species!\",\"userCount\":58,\"section\":\"Battle formats\"},{\"title\":\"Mafia\",\"desc\":\"A chat game about deception, intrigue, and strategy. Can you survive the night?\",\"userCount\":57,\"section\":\"On-site games\"},{\"title\":\"Monotype\",\"desc\":\"Who wants type variety when you can have six dragon types?\",\"userCount\":213,\"section\":\"Battle formats\",\"subRooms\":[\"Monotype Events\",\"Monotype OM\"]},{\"title\":\"Nederlands\",\"desc\":\"Chat voor Nederlanders en Belgen! Kom voor de kaas, blijf voor de gezelligheid!\",\"userCount\":25,\"section\":\"Languages\"},{\"title\":\"NeverUsed\",\"desc\":\"Never Used but always loved!\",\"userCount\":79,\"section\":\"Battle formats\"},{\"title\":\"Other Metas\",\"desc\":\"Change your favorite Pokemon in new and exciting ways!\",\"userCount\":197,\"section\":\"Battle formats\",\"subRooms\":[\"OM Mashups\",\"Pure Hackmons\"]},{\"title\":\"OverUsed\",\"desc\":\"Smogon's most popular tier and central metagame!\",\"userCount\":559,\"section\":\"Battle formats\"},{\"title\":\"Português\",\"desc\":\"Aqui tem pastel de nata, samba e futebol, nós NÃO falamos espanhol.\",\"userCount\":76,\"section\":\"Languages\"},{\"title\":\"Pro Wrestling\",\"desc\":\"WWE, New Japan, AEW, and more!\",\"userCount\":16,\"section\":\"Entertainment\"},{\"title\":\"PU\",\"desc\":\"Our tier name doesn't mean anything. Not even if they say so on YouTube.\",\"userCount\":68,\"section\":\"Battle formats\"},{\"title\":\"RarelyUsed\",\"desc\":\"You won't believe how rarelyused these Pokemon are!\",\"userCount\":95,\"section\":\"Battle formats\",\"subRooms\":[\"RU Events\"]},{\"title\":\"Ruins of Alph\",\"desc\":\"Relive the Generation 1-8 tiers you loved and never forgot. Discover more.\",\"userCount\":293,\"section\":\"Battle formats\"},{\"title\":\"Scavengers\",\"desc\":\"The hunt is on! Solve the clues or create your own!\",\"userCount\":36,\"section\":\"On-site games\"},{\"title\":\"Smogon Doubles\",\"desc\":\"Double the Pokémon, double the fun!\",\"userCount\":54,\"section\":\"Battle formats\"},{\"title\":\"Sports\",\"desc\":\" Yes, but can he do it on a cold rainy night in Stoke?\",\"userCount\":34,\"section\":\"Entertainment\"},{\"title\":\"Survivor\",\"desc\":\"We're like gambling without the crippling debt and self-destructive behavior.\",\"userCount\":32,\"section\":\"On-site games\"},{\"title\":\"TCG & Tabletop\",\"desc\":\"Board Games, War Games, Card Games! If it fits on a table it fits in the room!\",\"userCount\":8,\"privacy\":\"hidden\"},{\"title\":\"Tech & Code\",\"desc\":\"printf(\\\"Hello, World!\\\\n\\\"); We aren't technical support.\",\"userCount\":31,\"section\":\"Life & hobbies\"},{\"title\":\"The Happy Place\",\"desc\":\"Come on in and hang out a while! We’re here to listen if you want to talk!\",\"userCount\":83,\"section\":\"Life & hobbies\"},{\"title\":\"The Studio\",\"desc\":\"Share, discuss, and listen to music with us!\",\"userCount\":43,\"section\":\"Entertainment\",\"subRooms\":[\"K–Pop\"]},{\"title\":\"Trivia\",\"desc\":\"Learn something new every day!\",\"userCount\":63,\"section\":\"On-site games\"},{\"title\":\"Ubers\",\"desc\":\"The most inclusive of Smogon’s tiers, home of the most powerful Pokémon!\",\"userCount\":136,\"section\":\"Battle formats\"},{\"title\":\"UnderUsed\",\"desc\":\"Underused but not underplayed!\",\"userCount\":125,\"section\":\"Battle formats\"},{\"title\":\"VGC\",\"desc\":\"Are you the next World Champion? Pokémon's official competitive format!\",\"userCount\":442,\"section\":\"Battle formats\",\"subRooms\":[\"VGCLT\"]},{\"title\":\"Video Games\",\"desc\":\"RPGs, Shooters, Consoles and Computers. There's more than just Pokémon.\",\"userCount\":41,\"section\":\"Gaming\"},{\"title\":\"YouTube\",\"desc\":\"Discover, create and consume YouTube and Twitch content!\",\"userCount\":27,\"section\":\"Entertainment\"},{\"title\":\"Wi‐Fi\",\"desc\":\"Come discuss, play, trade, and collect with us in the mainline Switch games!\",\"userCount\":79,\"section\":\"Gaming\"},{\"title\":\"1v1\",\"desc\":\"The one and only metagame\",\"userCount\":67,\"section\":\"Battle formats\"},{\"title\":\"Español\",\"desc\":\"La sala en donde se puede usar la letra Ñ\",\"userCount\":126,\"section\":\"Languages\",\"subRooms\":[\"Eventos\"]},{\"title\":\"Pokémon Go\",\"desc\":\"The game that finally got everyone to GO outside.\",\"userCount\":26,\"section\":\"Gaming\"},{\"title\":\"Anime and Manga\",\"desc\":\"Watch Chinese Cartoons and Read Moon Glyphs with us.\",\"userCount\":56,\"section\":\"Entertainment\"},{\"title\":\"Random Battles\",\"desc\":\"No team? No problem! Join us for discussion and play of all randomized formats!\",\"userCount\":416,\"section\":\"Battle formats\"},{\"title\":\"Hindi\",\"desc\":\"तीसरे अधिकतम बोले जाने वाली भाषा का रूम।Teesri adhiktam bole jaane waali bhasha.\",\"userCount\":15,\"section\":\"Languages\",\"subRooms\":[\"Galli Galli Sim Sim\"]},{\"title\":\"The Cafe\",\"desc\":\"Pokémon Showdown's Food Room! #PutAnEggOnIt\",\"userCount\":27,\"section\":\"Life & hobbies\"},{\"title\":\"Pokemon Games\",\"desc\":\" Join us in discussion as we all experience our Pokémon adventures together!\",\"userCount\":39,\"section\":\"Gaming\"},{\"title\":\"The Library\",\"desc\":\"From research to fantasy, come explore reading, writing, science, and more!\",\"userCount\":25,\"section\":\"Entertainment\"},{\"title\":\"ZeroUsed\",\"desc\":\"Zero to hero just like that!\",\"userCount\":39,\"section\":\"Battle formats\"},{\"title\":\"TV & Films\",\"desc\":\"The headquarters for all TV & Film discussion! Entertainment awaits.\",\"userCount\":22,\"section\":\"Entertainment\"},{\"title\":\"Board Games\",\"desc\":\"If you find yourself board, play some games here!\",\"userCount\":22,\"section\":\"On-site games\"},{\"title\":\"League of Legends\",\"desc\":\"The premier MOBA hangout! TFT/LoR/Valorant discussion also encouraged.\",\"userCount\":11,\"privacy\":\"hidden\"},{\"title\":\"Battle Stadium\",\"desc\":\"Scarlet & Violet's official in-game ranked ladder metagames and competitions.\",\"userCount\":15},{\"title\":\"National Dex OU\",\"desc\":\"Don't like the dex cuts? Talk about formats that ignore it!\",\"userCount\":208,\"section\":\"Battle formats\",\"subRooms\":[\"National Dex UU\",\"National Dex Monotype\",\"ND Other Tiers\"]},{\"title\":\"Trainer Academy\",\"desc\":\"Get started with competitive Pokémon!\",\"userCount\":33,\"section\":\"Battle formats\"},{\"title\":\"Dungeons & Dragons\",\"desc\":\"Prepare your digital dice and imagination, we're going on an adventure!\",\"userCount\":47,\"section\":\"Life & hobbies\"},{\"title\":\"Pets & Animals\",\"desc\":\"The purrfect place for all your animal curiosities!\",\"userCount\":42,\"section\":\"Life & hobbies\"},{\"title\":\"Trick House\",\"desc\":\"Challenge yourself with new ways to play Pokémon!\",\"userCount\":33,\"privacy\":\"hidden\"},{\"title\":\"Unofficial Metas\",\"desc\":\"Come play cart-playable metagames with unique banlists with us!\",\"userCount\":36},{\"title\":\"Draft\",\"desc\":\"When you want to be the only person with Great Tusk!\",\"userCount\":34,\"subRooms\":[\"Speed Tours\"]},{\"title\":\"한국어 Korean\",\"desc\":\"한국어로 포켓몬에 대해 이야기 나눠요!\",\"userCount\":18,\"section\":\"Languages\"},{\"title\":\"The Art Gallery\",\"desc\":\"A place to share and discuss art of all kinds!\",\"userCount\":26,\"section\":\"Life & hobbies\"},{\"title\":\"The Wilderness\",\"desc\":\"Kick ass, touch grass, and have a beautiful day :)\",\"userCount\":45,\"section\":\"Life & hobbies\"}],\"sectionTitles\":[\"Official\",\"Battle formats\",\"Languages\",\"Entertainment\",\"Gaming\",\"Life & hobbies\",\"On-site games\"],\"userCount\":18104,\"battleCount\":2910}"
    ],
    [
        "<< >othermetas\n|c:|1732648584|@Gimlaf|I would assume that regular megas use their flipped stats. I have no clue what would happen in a flipped/MnM mashup tho"
    ],
    [
        "<< >othermetas\n|L| salsa1133"
    ],
    [
        "<< >othermetas\n|L| i hate mienshao"
    ]
]


// Read that log
// Read from command line (for testing)
/*const readline = require('node:readline');
const rl = readline.createInterface({
 input: process.stdin,
 output: process.stdout,
});
rl.question(`Line: `, string => {
   console.log('')
   args = splitInput(string)
   for (arg of args) {
       console.log(arg)
   }

   processInput(args)

   rl.close();
});*/


// Bind the console to an array
function setup_logging() {
    console.stdlog = console.log.bind(console);
    console.logs = [];
    console.log = function(){
        console.logs.push(Array.from(arguments));
        console.stdlog.apply(console, arguments);
    }
}

async function generatePossibleItems(poke, ability, moves) {
    // Boilerplate for simplification
    let species = gen.dex.species.get(poke['species']['name'])
    if (ability == undefined)
        var abilities = await Object.values(species.abilities)
    else
        var abilities = [ability]
    //console.log(abilities)
    let types = species.types

    if (!moves  || moves.length < 4) {
        let buh = await gen.dex.learnsets.get(species.name)
        //console.log(buh['learnset'])
        var moves = Object.keys(buh['learnset'])

    }
    //console.log(types)


    // Priority Fully Correct
    var probables = []

    if (species.id === 'lokix') {
        probables.push('Silver Powder')
        probables.push('Life Orb')
    }

    if (species.requiredItems) {
        if (species.baseSpecies === 'Arceus')
            probables.push(species.requiredItems[0])
        else
            probables.push(species.requiredItems)
    }

    if (species.id === 'pikachu')
        probables.push('Light Ball')
    if (species.id === 'regieleki')
        probables.push('Magnet')
    if (types.includes('Normal') && moves.includes('doubleedge') && moves.includes('fakeout'))
        probables.push('Silk Scarf')

    if (species.id === 'froslass' || moves.includes('populationbomb') || abilities.includes('Hustle'))
        probables.push('Wide Lens')

    if(species.id === 'smeargle')
        probables.push('Focus Sash')
    if (moves.includes('clangoroussoul') || (species.id === 'toxtricity' && moves.includes('shiftgear')))
        probables.push('Throat Spray')
    if (species.baseSpecies === 'Magearna' || species.id === 'necrozmaduskmane')
        probables.push('Weakness Policy')
    if (['dragonenergy', 'lastrespects', 'waterspout'].some(m => moves.includes(m)))
        probables.push('Choice Scarf')
    if (abilities.includes('Imposter') || (species.id === 'magnezone'))
        probables.push('Choice Scarf')
    if (species.id === 'rampardos')
        probables.push('Choice Scarf')
    if (species.id === 'palkia')
        probables.push('Lustrous Orb')
    if (abilities.includes('Quark Drive') || abilities.includes('Protosynthesis'))
        probables.push('Booster Energy')

    if (moves.includes('courtchange') || species.id === 'luvdisc' || species.id === 'terapagos' && !moves.includes('rest'))
        probables.push('Heavy-Duty Boots')

    if (moves.includes('bellydrum') && moves.includes('substitute'))
        probables.push('Salac Berry')

    if (abilities.includes('Cheek Pouch') || abilities.includes('Cud Chew') || abilities.includes('Harvest') || abilities.includes('Ripen') || moves.includes('bellydrum') || moves.includes('filletaway'))
        probables.push('Sitrus Berry')

    if (['healingwish', 'switcheroo', 'trick'].some(m => moves.includes(m))) {
        if (species.baseStats.spe >= 60 && species.baseStats.spe <= 108)
				probables.push('Choice Scarf')
			probables.push('Choice Band')
            probables.push('Choice Specs')
    }

    if (species.name === 'Latias' || species.name === 'Latios')
        probables.push('Soul Dew')
    if (species.id === 'scyther')
        probables.push('Heavy-Duty Boots')
    if (abilities.includes('Poison Heal') || abilities.includes('Quick Feet'))
        probables.push('Toxic Orb')
    if (species.nfe)
        probables.push('Eviolite')

    if ((abilities.includes('Guts') || moves.includes('facade')) && !moves.includes('sleeptalk')) {
        if (types.includes('Fire') || abilities.includes('Toxic Boost'))
            probables.push('Toxic Orb')
        else
            probables.push('Flame Orb')
    }

    if (abilities.includes('Magic Guard') || abilities.includes('Sheer Force'))
        probables.push('Life Orb')

    if (abilities.includes('Anger Shell')) {
        probables.push('Rindo Berry')
        probables.push('Passho Berry')
        probables.push('Sitrus Berry')
        probables.push('Scope Lens')
    }

    probables.push('Loaded Dice')

    if (abilities.includes('Unburden'))
        if (moves.includes('closecombat') || moves.includes('leafstorm'))
            probables.push('White Herb')
        else
            probables.push('Sitrus Berry')

    if (moves.includes('shellsmash') && !abilities.includes('Weak Armor'))
        probables.push('White Herb')
    if (moves.includes('meteorbeam') || moves.includes('electroshot'))
        probables.push('Power Herb')
    if (moves.includes('acrobatics') && ability !== 'Protosynthesis')
        probables.push('')
    if (moves.includes('auroraveil') || moves.includes('lightscreen') && moves.includes('reflect'))
        probables.push('Light Clay')

    if (abilities.includes('Gluttony')) {
        probables.push('Aguav Berry')
        probables.push('Figy Berry')
        probables.push('Iapapa Berry')
        probables.push('Mago Berry')
        probables.push('Wiki Berry')
    }

    if(moves.includes('rest') && !abilities.includes('Natural Cure') && !abilities.includes('Shed Skin') && !moves.includes('sleeptalk'))
        probables.push('Chesto Berry')

    if(species.id !== 'yanmega' && gen.dex.getEffectiveness('Rock', species) >= 2 && (!types.includes('Flying')))
        probables.push('Heavy-Duty Boots')

    return probables
}

function getPokeName(input) {
    return input.substring(5)
}

function checkMajor(input) {
    const major = ['move', 'switch', 'detailschange', 'replace', 'swap', 'cant', 'faint']
    return major.includes(input)
}

function checkBattleMessage(message) {
    const battleHeader = '<< >battle-gen9randombattle'

    for (var i=0; i< battleHeader.length; i++) {
        if (message[i] != battleHeader[i])
            return false
    }
    return true
}

function splitInput(input) {
    var lines = input.split('\n')
    var ret = []
    for (var line of lines) {
        line = line.substring(1)
        if (line != '')
            ret.push(line.split('|'))
            //ret.push(line)
    }
    return ret
    //return lines
}

function moveNameRegex(input) {
    let regex = /[A-Za-z0-9]+\s+[A-Za-z0-9]+/;
    return regex.test(input);
}

function checkPokename(input) {
    let regex = /\b(p1a:|p2a:)\s*[A-Za-z0-9\s-]+\b/;
    return regex.test(input);
}

/*function unusedOldSwitch() {
                // Get move details by looping until the end of the array or until done
            dets = []
            for (var j=i+4; j<args.length; j++) {
                endReached = false
                // Filter to keep only the details needed.  Throw out anything unnecessary
                switch(args[j]) {
                    case '-clearallboost':
                    case '-swapsideconditions':
                    case '-combine':
                    case '-nothing':
                        dets.push(args[j])
                        break;

                    case '-supereffective':
                    case '-notarget':
                    case '-crit':
                    case '-resisted':
                    case '-immune':
                        dets.push(args[j])
                        j += 1
                        break;

                    case '-fail':
                    case '-miss':
                        dets.push(args[j])
                        j += 2
                        break;

                    case '-block':
                        dets.push(args[j])
                        j += 4
                        break;

                    case '-cureteam':
                    case '-invertboost':
                    case '-clearboost':
                    case '-clearnegativeboost':
                    case '-weather':
                    case '-fieldstart':
                    case '-endability':
                    case '-primal':
                    case '-zpower':
                    case '-zbroken':
                    case '-activate':
                    case '-mustrecharge':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        j += 1
                        break;

                    case '-damage': // Keep pokemon and HP/Status (if there is a status or an HP.  Further do actions based on specific detail)
                    case '-heal':
                    case '-sethp':
                    case '-status':
                    case '-curestatus':
                    case '-copyboost':
                    case '-sidestart':
                    case '-sideend':
                    case '-start':
                    case '-end':
                    case '-transform':
                    case '-mega':
                    case '-waiting':
                    case '-hitcount':
                    case '-singlemove':
                    case '-singleturn':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        j += 2
                        break;

                    case '-item':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        if (args[j+2] == 'Air Balloon') {
                            dets.push(args[j+3])
                            j += 1
                        }
                        j += 2
                        break;

                    case '-enditem':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        if (args[j+2] == 'Air Balloon' || args[j+3] == '[eat]') {
                            dets.push(args[j+3])
                            j += 1
                        }
                        j += 2
                        break;

                    case '-ability':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        if (not(args[i] == 'switch' || args[i] == 'pull')) {
                            dets.push(args[j+3])
                            j += 1
                        }
                        j += 2
                        break;

                    case '-prepare':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        if (checkPokename(args[j+3])) {
                            dets.push(args[j+3])
                            j += 1
                        }
                        j += 2
                        break;


                    case '-boost':
                    case '-unboost':
                    case '-swapboost':
                    case '-clearpositiveboost':
                    case '-burst':
                        dets.push(args[j])
                        dets.push(args[j+1])
                        dets.push(args[j+2])
                        dets.push(args[j+3])
                        j += 3
                        break;


                    default:
                        endReached = true
                }

                if (endReached)
                    break;

            }
}*/

function processInput(args) {
    let actions = []
    let alldets = []
    //Iterate through, checking each argument for an action
    for (var i=0; i<args.length; i++) {

        if (checkMajor(args[i][0])) {
            actions.push(args[i])
            var dets = []
            // Get move basics
            //let user = args[i][1]
            //let move = args[i][2]
            //let targ = args[i][3]

            for (var j=i+1; j<args.length; j++) {
                if (args[j][0][0] === '-')
                    dets.push(args[j])
                else {
                    i = j-1
                    break;
                }
            }
            alldets.push(dets)
        }
    }
    if (actions.length > 0)
        return {actions: actions, dets:alldets}
}

function processMessage(message) {
    var args = splitInput(message)
    let processedInput = processInput(args)
    if (processedInput)
        return processedInput
}

function processLogs(logs) {
    let parsedMessages = []
    for (var log of logs) {
        if (checkBattleMessage(log[0])) {
            let parsedMessage = processMessage(log[0])
            if (parsedMessage)
                parsedMessages.push(parsedMessage)
        }
    }
    return parsedMessages
}

function copyPokemon(pokemon) {
    let copy = new Pokemon(gen, pokemon.name, {nature: 'Hardy', evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85}})
    copy.item = pokemon.item
    copy.ability = pokemon.ability
    copy.level = pokemon.level
    copy.moves = pokemon.moves
    copy.stats = pokemon.stats
    copy.boosts = pokemon.boosts
    copy.status = pokemon.status
    copy.abilityOn = pokemon.abilityOn
    copy.isSaltCure = pokemon.isSaltCure
    copy.alliesFainted = pokemon.alliesFainted
    copy.boostedStat = pokemon.boostedStat
    copy.originalCurHP = pokemon.originalCurHP
    copy.toxicCounter = pokemon.toxicCounter
    copy.volatiles = pokemon.volatiles
    copy.types = pokemon.types
    copy['teraType'] = pokemon['teraType']
    return copy
}

function createPokemon(name) {
    return new Pokemon(gen, name, {
        nature: 'Hardy',
        evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85}
    })
}

function createTeam(gen, input, pokemon) {
    var pokes = input.split('\n\n')
    console.log(pokes)

    //var pokemon = []
    var teraTypes = []
    var ctr = 0
    for (var poke of pokes) {
        var lines = poke.split('\n')

        //Split first line to get species and item
        var items = lines[0].split('@')
        var name = items[0].substring(0, items[0].length - 1)
        //Check for Galar and Alola versions
        if (name.indexOf('(') != -1) {
            var start = name.indexOf('(')+1
            var end = name.indexOf(')')
            var nameSub = name.substring(start, end)

            if(nameSub.indexOf('Galar') != -1 || nameSub.indexOf('Alola') != -1)
                name = nameSub
        }

        var item = items[1].substring(1)

        //Get Ability
        var ability = lines[1].substring(9)
        var level = Number(lines[2].substring(7))
        var tera = lines[3].substring(11)


        let move_lines = [5, 6, 7, 8]
        if (lines[5][0] !== '-')
            for (let i=0; i<4; i++)
                move_lines[i] += 1

        var moves = [new Move(gen, lines[move_lines[0]].substring(2)), new Move(gen, lines[move_lines[1]].substring(2)), new Move(gen, lines[move_lines[2]].substring(2)), new Move(gen, lines[move_lines[3]].substring(2))]

        console.log(name, item, ability, level, tera, moves)

        if (name === 'Hatterene (F)' || name === 'Hatterene (M)')
            name = 'Hatterene'
        if (name === 'Deoxys (Deoxys-Speed)')
            name = 'Deoxys-Speed'

        let pokemonNames = Object.values(Dex.species.all()).map(species => species.name)
        if (!pokemonNames.includes(name)) {
            let tempName;
            for(let i=0; i<pokemonNames.length; i++) {
                if (name.indexOf(pokemonNames[i]) !== -1)
                    tempName = pokemonNames[i]
            }
            name = tempName
        }

        pokemon.push(new Pokemon(gen, name, {
            item:item,
            nature: 'Hardy',
            evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
            ability: ability,
            level: level,
            moves: moves
        }))


        pokemon[ctr]['teraType'] = tera

        teraTypes.push(tera)
        ctr += 1
    }
    return pokemon, teraTypes
}

function packPokemon(pokemon) {
    let ret = {species: pokemon['name'], evs: {hp:85, atk:85, def:85, spa:85, spd:85, spe:31}, nature: 'Hardy', ivs: {hp:31, atk:31, def:31, spa:31, spd:31, spe:31}, level: pokemon['level'], ability: pokemon['ability']}

    if (pokemon['item'])
        ret['item'] = pokemon['item']
    if (pokemon['moves'][0])
        ret['moves'] = [pokemon['moves'][0]['name']]
    if (pokemon['moves'][1])
        ret['moves'].push(pokemon['moves'][1]['name'])
    if (pokemon['moves'][2])
        ret['moves'].push(pokemon['moves'][2]['name'])
    if (pokemon['moves'][3])
        ret['moves'].push(pokemon['moves'][3]['name'])
    return ret
}

function getDamages(user, target, move) {
    // Generate the move variants (crit)
    let critMove = new Move(gen, move['name'])
    critMove['isCrit'] = true

    // Get detailed move info
    let dexMove = gen.dex.moves.get(move['name'])
    let missChance = dexMove['accuracy']
    let critChance = (1/24) * dexMove['critRatio']

    //Get user variants
    let userVariants = []

    if (user instanceof uncertainPokemon) {
        // Generate variants for each ability
        for (let ability of user['abilities']) {
            let userVariant = copyPokemon(user.pokemon)
            userVariant['ability'] = ability
            userVariants.push(userVariant)
        }

        // Generate variants for each item
        let cap = userVariants.length
        for (let i = 0; i < cap; i++) {
            for (let item of user['items']) {
                let itemVariant = copyPokemon(userVariants[i])
                itemVariant['item'] = item
                userVariants.push(itemVariant)
            }
            userVariant.shift()
        }
    }
    else {
        userVariants.push(user)
    }

    // Get target variants
    let targetVariants = []

    if (target instanceof uncertainPokemon) {
        // Generate variants for each ability
        for (let ability of target['abilities']) {
            let targetVariant = copyPokemon(target.pokemon)
            targetVariant['ability'] = ability
            targetVariants.push(targetVariant)
        }

        // Generate variants for each item
        let cap = targetVariants.length
        for (let i=0; i<cap; i++) {
            for (let item of target['items']) {
                let itemVariant = copyPokemon(targetVariants[i])
                itemVariant['item'] = item
                targetVariants.push(itemVariant)
            }
            targetVariants.shift()
        }
    }
    else {
        targetVariants.push(target)
    }

    // Get damages
    let damagePercs = {}

    for (let userVariant of userVariants) {
        for (let targetVariant of targetVariants) {
            let standardRes = calculate(gen, userVariant, targetVariant, move)
            let standardDamage = {}
            if(standardRes['damage'] instanceof(Array)) {
                for (const dmg of standardRes['damage'])
                    standardDamage[dmg] = standardDamage[dmg] ? standardDamage[dmg] + 1 : 1
            }
            else {
                standardDamage[0] = 1
            }
            let sumDamages = Object.values(standardDamage).reduce((partialSum, a) => partialSum + a, 0);

            for (const dmg of Object.keys(standardDamage)) {
                if (damagePercs[dmg])
                    damagePercs[dmg] += standardDamage[dmg]/sumDamages*(1-critChance)
                else
                    damagePercs[dmg] = standardDamage[dmg]/sumDamages*(1-critChance)
            }

            let critRes = calculate(gen, userVariant, targetVariant, critMove)
            let critDamage = {}
            if (critRes['damage'] instanceof(Array)) {
                for (const dmg of critRes['damage'])
                    critDamage[dmg] = critDamage[dmg] ? critDamage[dmg] + 1 : 1
            }
            else {
                critDamage[0] = 1
            }
            let sumCritDamages = Object.values(critDamage).reduce((partialSum, a) => partialSum + a, 0);


            for (const dmg of Object.keys(critDamage)) {
                if (damagePercs[dmg])
                    damagePercs[dmg] += critDamage[dmg]/sumCritDamages*critChance
                else
                    damagePercs[dmg] = critDamage[dmg]/sumCritDamages*critChance
            }
        }
    }


    for (const dmg of Object.keys(damagePercs))
        damagePercs[dmg] = damagePercs[dmg] / userVariants.length / targetVariants.length

    // Add possibility of a miss
    if (typeof(dexMove.accuracy) !== "boolean") {
        damagePercs[0] = (1-missChance/100)
        for (const dmg of Object.keys(damagePercs))
            damagePercs[dmg] = damagePercs[dmg] * (missChance/100)
    }
    return damagePercs
}

function getMoveOutcomes(user, target, move) {
    // Check move category
    let dexMove = gen.dex.moves.get(move['name'])
    let damagePercs = {0:1}
    if (move.category !== 'Status') {
        // Get damages
        damagePercs = getDamages(user, target, move)
    }

    //Convert "true" accuracy to 100%
    let acc = dexMove.accuracy
    if (acc === true)
        acc = 1
    else
        acc /= 100

    //Get main non-damaging effects
    let selfBoosts = {}
    let targetBoosts = {}
    let selfStatus = {}
    let targetStatus = {}
    let drain = {}
    let healing

    let weather

    if (dexMove.status) {
        if (dexMove.target === 'self')
            selfStatus[dexMove.status] = acc
        else
            targetStatus[dexMove.status] = acc
    }

    if (dexMove.volatileStatus) {
        if (dexMove.target === 'self')
            selfStatus[dexMove.volatileStatus] = acc
        else
            targetStatus[dexMove.volatileStatus] = acc
    }

    if (dexMove.weather) {
        weather = dexMove.weather
    }

    if (dexMove.boosts) {
        if (dexMove.target === 'self')
            selfBoosts[dexMove.boosts] = acc
        else
            targetBoosts[dexMove.boosts] = acc
    }

    if (dexMove.self) {
        if (dexMove.self.boosts) {
            selfBoosts[dexMove.self.boosts] = acc
        }
        if (dexMove.self.volatileStatus) {
            selfStatus[dexMove.self.volatileStatus] = acc
        }
    }

    if (dexMove.drain) {
        for (const dmg of Object.keys(damagePercs))
            drain[dmg] = Math.floor(dexMove.drain[0]*dmg/dexMove.drain[1])
    }

    if (dexMove.heal) {
        healing = dexMove.heal[0]/dexMove.heal[1]
    }

    // Get secondary effects
    if (dexMove.secondaries) {
        for (let i=0; i<dexMove.secondaries.length; i++) {
            let secondary = dexMove.secondaries[i]
            if (secondary.chance) {
                if (dexMove.target === 'self')
                    if (secondary.boosts)
                        selfBoosts[secondary.boosts] = secondary.chance/100
                    else if (secondary.status)
                        selfStatus[secondary.status] = secondary.chance/100
                else {
                    if (secondary.boosts)
                        targetBoosts[secondary.boosts] = secondary.chance/100
                    else if (secondary.status)
                        targetStatus[secondary.status] = secondary.chance/100
                }
            }
            else {
                if (dexMove.target === 'self')
                    if (secondary.boosts)
                        selfBoosts[secondary.boosts] = 1
                    else if (secondary.status)
                        selfStatus[secondary.status] = 1
                else {
                    if (secondary.boosts)
                        targetBoosts[secondary.boosts] = 1
                    else if (secondary.status)
                        targetStatus[secondary.status] = 1
                }
            }
        }
    }
    return {damagePercs: damagePercs, selfBoosts: selfBoosts, targetBoosts: targetBoosts, selfStatus: selfStatus, targetStatus: targetStatus, weather: weather, drain: drain, healing: healing}
}

async function copyState(state, jsonInput=undefined) {
    let jsonData
    if (!jsonInput) {
        jsonData = state.sim.toJSON()
    }
    else
        jsonData = Object.assign({}, jsonInput, {})
    jsonData.prngSeed = [Math.floor(Math.random() * 65536), Math.floor(Math.random() * 65536), Math.floor(Math.random() * 65536), Math.floor(Math.random() * 65536)]
    //jsonData.forceRandomChance = true
    let newState = new State(state.team, state.enemyTeam, Battle.fromJSON(jsonData))
    for(let i=0; i<6; i++) {
        newState.enemyMovesKnown[i] = state.enemyMovesKnown[i]
    }
    newState.sim.log = []
    return newState
}

//====================================================================================================================//
//=================================================|Runner Functions|=================================================//
//====================================================================================================================//

function systemSetup() {
    //setup_logging()
    return processLogs(logs)
}

function teamSetup(teamString) {
    let pokemon = []
    let teraTypes
    pokemon, teraTypes = createTeam(gen, teamString, pokemon)

    let packedTeam = Teams.pack([
        packPokemon(pokemon[0]),
        packPokemon(pokemon[1]),
        packPokemon(pokemon[2]),
        packPokemon(pokemon[3]),
        packPokemon(pokemon[4]),
        packPokemon(pokemon[5])
    ])
    return {pokemon:pokemon, team:packedTeam}
}

function getMoves(pokemon) {
    let moves = []
    let moveCategories;
    if (pokemon.stats['atk'] > pokemon.stats['spa'])
        moveCategories = physicalMoves
    else
        moveCategories = specialMoves

    if(pokemon['types'].length > 1) {
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][0]])
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][1]])
        if(moves.includes(moveCategories[typeMatchups[pokemon['types'][1]][0]])) {
            if(moves.includes(moveCategories[typeMatchups[pokemon['types'][1]][1]]))
                moves.push(moveCategories[typeMatchups[pokemon['types'][1]][2]])
            else
                moves.push(moveCategories[typeMatchups[pokemon['types'][1]][1]])
        }
        else
            moves.push(moveCategories[typeMatchups[pokemon['types'][1]][0]])

        if(moves.includes(moveCategories[typeMatchups[pokemon['types'][1]][1]])) {
            if(moves.includes(moveCategories[typeMatchups[pokemon['types'][1]][2]]))
                moves.push(moveCategories[typeMatchups[pokemon['types'][1]][3]])
            else
                moves.push(moveCategories[typeMatchups[pokemon['types'][1]][2]])
        }
        else
            moves.push(moveCategories[typeMatchups[pokemon['types'][1]][1]])
    }
    else {
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][0]])
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][1]])
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][2]])
        moves.push(moveCategories[typeMatchups[pokemon['types'][0]][3]])
    }

    return moves
}



async function stateSetup(teamString, enemyFirst, verbose=false, enemyTeam=undefined) {
    let states = []

    let packedTeam
    let pokemon

    if (teamString.isString) {
        let ret = teamSetup(teamString)
        packedTeam = ret['team']
        pokemon = ret['pokemon']
    }
    else {
        packedTeam = Teams.pack(teamString)
        pokemon = teamString
    }

    if (enemyTeam) {
        let enemyPack = Teams.pack(enemyTeam)
        let battle = new Battle(gen.dex)
        battle.rated = true
        battle.setPlayer(`p1`, {team: packedTeam})
        battle.setPlayer(`p2`, {team: enemyPack})
        states.push({state: new State(pokemon, enemyTeam, battle), chance: 1})
        return states
    }
    else {
        let enemyTeam = [enemyFirst]

        let moves = getMoves(enemyTeam[0].pokemon)
        enemyTeam[0].pokemon['moves'] = [new Move(gen, moves[0]), new Move(gen, moves[1]), new Move(gen, moves[2]), new Move(gen, moves[3])]
        enemyTeam[0].abilities = Object.values(gen.dex.species.get(enemyTeam[0].pokemon.name).abilities)
        enemyTeam[0].items = await generatePossibleItems(enemyTeam[0].pokemon)

        // To prevent premature losses, fill the enemy team's simulator with level 1 magikarp.
        let magikarp = new Pokemon(gen, 'Magikarp', {
            nature: 'Hardy',
            level: 1,
            evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85}
        })
        magikarp['moves'] = [new Move(gen, 'splash')]


        let enemyPack = [packPokemon(enemyTeam[0].pokemon), packPokemon(magikarp), packPokemon(magikarp), packPokemon(magikarp), packPokemon(magikarp), packPokemon(magikarp)]


        //var enemyPack = [packPokemon(new Pokemon(gen, 'Scyther'))]
        //enemyPack[0]['moves'] = ['Aerial Ace', 'X-Scissor', 'Swords Dance', 'Quick Attack']
        enemyPack = Teams.pack(enemyPack)

        let battle = new Battle(gen.dex)
        battle.rated = true
        battle.setPlayer(`p${playerNum}`, {team: packedTeam})
        battle.setPlayer(`p${enemyNum}`, {team: enemyPack})

        states.push({state: new State(pokemon, enemyTeam, battle), chance: 1})

        return states
    }

    //Todo: Setup multiple states, one per each possible item and ability
}

async function getMoveStates(intermediateState, outcomes, user_side, target_side) {
    let newStates = []

    for (const dmg of Object.keys(outcomes.damagePercs)) {
        let chance = outcomes.damagePercs[dmg]

        let newState = copyState(intermediateState)
        newState.sim.damage(Number(dmg), newState.sim.getSide(target_side).active[0], null, null, 'custom-damage')
        if (outcomes.drain[dmg]) {
            newState.sim.heal(outcomes.drain[dmg], newState.sim.getSide(user_side).active[0], null, null, 'drain')
        }
        newStates.push({state: newState, chance: chance})
    }

    for (const boost of Object.keys(outcomes.selfBoosts)) {
        let chance = outcomes.selfBoosts[boost]

        if (chance === 1)
            for (let k=0; k<newStates.length; k++)
                newStates[k].state.sim.boost(boost, intermediateState.sim.getSide(user_side).active[0])
        else {
            let cap = newStates.length
            for (let k=0; k<cap; k++) {
                let newState = copyState(newStates[k].state)
                newState.sim.boost(boost, newState.sim.getSide(user_side).active[0])
                newStates.push({state: newState, chance: chance*outcomes.selfBoosts[boost]})
            }
        }
    }

    for (const boost of Object.keys(outcomes.targetBoosts)) {
        let chance = outcomes.targetBoosts[boost]

        if (chance === 1)
            for (let k=0; k<newStates.length; k++)
                newStates[k].state.sim.boost(boost, intermediateState.sim.getSide(target_side).active[0])
        else {
            let cap = newStates.length
            for (let k=0; k<cap; k++) {
                let newState = copyState(newStates[k].state)
                newState.sim.boost(boost, newState.sim.getSide(target_side).active[0])
                newStates.push({state: newState, chance: chance*outcomes.targetBoosts[boost]})
            }
        }
    }

    for (const status of Object.keys(outcomes.selfStatus)) {
        let chance = outcomes.selfStatus[status]

        if (chance === 1)
            for (let k=0; k<newStates.length; k++)
                newStates[k].state.sim.setStatus(status, intermediateState.sim.getSide(user_side).active[0])
        else {
            let cap = newStates.length
            for (let k=0; k<cap; k++) {
                let newState = copyState(newStates[k].state)
                newState.sim.setStatus(status, newState.sim.getSide(user_side).active[0])
                newStates.push({state: newState, chance: chance*outcomes.selfStatus[status]})
            }
        }
    }

    for (const status of Object.keys(outcomes.targetStatus)) {
        let chance = outcomes.targetStatus[status]

        if (chance === 1)
            for (let k=0; k<newStates.length; k++)
                newStates[k].state.sim.setStatus(status, intermediateState.sim.getSide(target_side).active[0])
        else {
            let cap = newStates.length
            for (let k=0; k<cap; k++) {
                let newState = copyState(newStates[k].state)
                newState.sim.setStatus(status, newState.sim.getSide(target_side).active[0])
                newStates.push({state: newState, chance: chance*outcomes.targetStatus[status]})
            }
        }
    }

    if (outcomes.weather) {
        for(let k=0; k<newStates.length; k++)
            newStates[k].state.sim.setWeather(outcomes.weather)
    }

    if (outcomes.healing) {
        for(let k=0; k<newStates.length; k++)
            newStates[k].state.sim.heal(outcomes.healing*intermediateState.sim.getSide(user_side).active[0].maxhp, intermediateState.sim.getSide(user_side).active[0], null, null, 'heal')
    }
    return newStates
}

// async function getNextStates(state) {
//     let allStates = []
//     // First get damages for each move of user's active pokemon against all enemy pokemon
//     for (let i=0; i<state.enemyTeam.length; i++) {
//         if (!state.enemyTeam[i].pokemon || state.enemyTeam[i].pokemon.status === 'fnt' )
//             // Fainted pokemon can't come out
//             continue
//         let perPokeStates = []
//
//         let intermediateState = copyState(state)
//
//         if (state.activeMon[1] !== i) {
//             // If the enemy would switch, have that switch occur
//             intermediateState.sim.actions.switchIn(intermediateState.sim.sides[enemyNum-1].pokemon[i], 0)
//             while(intermediateState.sim.queue.length > 0)
//                 intermediateState.sim.runAction(intermediateState.sim.queue.resolveAction(intermediateState.sim.queue.shift())[0])
//             intermediateState.activeMon[1] = i
//             // perPokeStates.push({state: intermediateState, chance: 1})
//
//             //Calculate move damages and effects on target
//             let newStates = []
//             for (let j=0; j<4; j++) {
//                 let move = intermediateState.team[intermediateState.activeMon[0]]['moves'][j]
//                 let outcomes = getMoveOutcomes(intermediateState.team[intermediateState.activeMon[0]], intermediateState.enemyTeam[i], move)
//                 newStates.push(await getMoveStates(intermediateState, outcomes, `p${playerNum}`, `p${enemyNum}`))
//             }
//         }
//
//         else {
//
//             for (let j = 0; j < intermediateState.enemyTeam[i].moves.length; i++) {
//
//             }
//
//         }
//
//         //Check each move
//         for (let j=0; j<4; j++) {
//             let newStates = []
//             let move = intermediateState.team[intermediateState.activeMon[0]]['moves'][j]
//             let outcomes = getMoveOutcomes(intermediateState.team[intermediateState.activeMon[0]], intermediateState.enemyTeam[i], move)
//
//             for (const dmg of Object.keys(outcomes.damagePercs)) {
//                 let chance = outcomes.damagePercs[dmg]
//
//                 let newState = copyState(intermediateState)
//                 newState.sim.damage(Number(dmg), newState.sim.getSide(`p${enemyNum}`).pokemon[i], null, null, 'custom-damage')
//                 if (outcomes.drain[dmg]) {
//                     newState.sim.heal(outcomes.drain[dmg], newState.sim.getSide(`p${playerNum}`).active[0], null, null, 'drain')
//                 }
//                 newStates.push({state: newState, chance: chance})
//             }
//
//             for (const boost of Object.keys(outcomes.selfBoosts)) {
//                 let chance = outcomes.selfBoosts[boost]
//
//                 if (chance === 1)
//                     for (let k=0; k<newStates.length; k++)
//                         newStates[k].state.sim.boost(boost, intermediateState.sim.getSide(`p${playerNum}`).active[0])
//                 else {
//                     let cap = newStates.length
//                     for (let k=0; k<cap; k++) {
//                         let newState = copyState(newStates[k].state)
//                         newState.sim.boost(boost, newState.sim.getSide(`p${playerNum}`).active[0])
//                         newStates.push({state: newState, chance: chance*outcomes.selfBoosts[boost]})
//                     }
//                 }
//             }
//
//             for (const boost of Object.keys(outcomes.targetBoosts)) {
//                 let chance = outcomes.targetBoosts[boost]
//
//                 if (chance === 1)
//                     for (let k=0; k<newStates.length; k++)
//                         newStates[k].state.sim.boost(boost, intermediateState.sim.getSide(`p${enemyNum}`).active[i])
//                 else {
//                     let cap = newStates.length
//                     for (let k=0; k<cap; k++) {
//                         let newState = copyState(newStates[k].state)
//                         newState.sim.boost(boost, newState.sim.getSide(`p${enemyNum}`).pokemon[i])
//                         newStates.push({state: newState, chance: chance*outcomes.targetBoosts[boost]})
//                     }
//                 }
//             }
//
//             for (const status of Object.keys(outcomes.selfStatus)) {
//                 let chance = outcomes.selfStatus[status]
//
//                 if (chance === 1)
//                     for (let k=0; k<newStates.length; k++)
//                         newStates[k].state.sim.setStatus(status, intermediateState.sim.getSide(`p${playerNum}`).active[0])
//                 else {
//                     let cap = newStates.length
//                     for (let k=0; k<cap; k++) {
//                         let newState = copyState(newStates[k].state)
//                         newState.sim.setStatus(status, newState.sim.getSide(`p${playerNum}`).pokemon[k])
//                         newStates.push({state: newState, chance: chance*outcomes.selfStatus[status]})
//                     }
//                 }
//             }
//
//             for (const status of Object.keys(outcomes.targetStatus)) {
//                 let chance = outcomes.targetStatus[status]
//
//                 if (chance === 1)
//                     for (let k=0; k<newStates.length; k++)
//                         newStates[k].state.sim.setStatus(status, intermediateState.sim.getSide(`p${enemyNum}`).active[i])
//                 else {
//                     let cap = newStates.length
//                     for (let k=0; k<cap; k++) {
//                         let newState = copyState(newStates[k].state)
//                         newState.sim.setStatus(status, newState.sim.getSide(`p${enemyNum}`).pokemon[i])
//                         newStates.push({state: newState, chance: chance*outcomes.targetStatus[status]})
//                     }
//                 }
//             }
//
//             if (outcomes.weather) {
//                 for(let k=0; k<newStates.length; k++)
//                     newStates[k].state.sim.setWeather(outcomes.weather)
//             }
//
//             if (outcomes.healing) {
//                 for(let k=0; k<newStates.length; k++)
//                     newStates[k].state.sim.heal(outcomes.healing*intermediateState.sim.getSide(`p${playerNum}`).active[0].maxhp, intermediateState.sim.getSide(`p${playerNum}`).active[0], null, null, 'heal')
//             }
//
//             perPokeStates.push(newStates)
//
//             //let outcomes = testMove(state.team[state.activeMon[0]], state.enemyTeam[i], move)
//             //let sumDamagePercs = Object.values(outcomes['damagePercs']).reduce((partialSum, a) => partialSum + a, 0)
//
//         }
//         allStates.push(perPokeStates)
//
//         // Multiply chances by the chance that the opponent would actually switch, based on their info of this pokemon, or maybe just 1/2 for switch spread among all remaining and known pokemon
//     }
//
//
//     return allStates
// }
// function pruneStatesByMove(states, move) {
//     let newStates = []
//     for (let i=0; i<states.length; i++) {
//         if (states[i].state.sim.sides[enemyNum-1].active[0]['moves'].includes(move)) {
//             newStates.push(state)
//         }
//     }
//     return newStates
// }
//
// function pruneStatesByAbility(states, ability) {
//     let newStates = []
//     for (let i=0; i<states.length; i++) {
//         if (states[i].state.sim.sides[enemyNum-1].active[0]['ability'] === ability) {
//             newStates.push(state)
//         }
//     }
//     return newStates
// }
//
// function pruneStatesByItem(states, item) {
//     let newStates = []
//     for (let i=0; i<states.length; i++) {
//         if (states[i].state.sim.sides[enemyNum-1].active[0]['item'] === item) {
//             newStates.push(state)
//         }
//     }
//     return newStates
// }


//todo add a way to change a broken illusion like from zoroark
async function changePokemon(state, pokePos, ability=undefined, item = undefined, knownMoves = [] ) {
    let simJSON = state.sim.toJSON()

    //Get the pokemon's data
    let enemyTeam = [new Pokemon(gen, state.enemyTeam[pokePos].pokemon.name, {
        nature: 'Hardy',
        level: Number(state.enemyTeam[pokePos].pokemon.level),
        evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
    })]

    if (ability)
        enemyTeam[0].ability = ability
    if (item)
        enemyTeam[0].item = item


    let moves = getMoves(enemyTeam[0])
    enemyTeam[0]['moves'] = [new Move(gen, moves[0]), new Move(gen, moves[1]), new Move(gen, moves[2]), new Move(gen, moves[3])]
    for (let i=0; i<knownMoves.length; i++)
        enemyTeam[0]['moves'][i] = new Move(gen, knownMoves[i])


    let enemyPack = [packPokemon(enemyTeam[0])]

    enemyPack = Teams.pack(enemyPack)
    let packedTeam = enemyPack

    let battle = new Battle(gen.dex)
    battle.rated = true
    battle.setPlayer(`p${playerNum}`, {team: packedTeam})
    battle.setPlayer(`p${enemyNum}`, {team: enemyPack})

    let tempJSON = battle.toJSON()


    simJSON.sides[enemyNum-1].pokemon[pokePos].moveSlots     =   tempJSON.sides[enemyNum-1].pokemon[0].moveSlots
    simJSON.sides[enemyNum-1].pokemon[pokePos].baseAbility   =   tempJSON.sides[enemyNum-1].pokemon[0].baseAbility
    simJSON.sides[enemyNum-1].pokemon[pokePos].ability       =   tempJSON.sides[enemyNum-1].pokemon[0].ability
    simJSON.sides[enemyNum-1].pokemon[pokePos].abilityState  =   tempJSON.sides[enemyNum-1].pokemon[0].abilityState
    simJSON.sides[enemyNum-1].pokemon[pokePos].item          =   tempJSON.sides[enemyNum-1].pokemon[0].item
    simJSON.sides[enemyNum-1].pokemon[pokePos].itemState     =   tempJSON.sides[enemyNum-1].pokemon[0].itemState
    simJSON.sides[enemyNum-1].pokemon[pokePos].lastItem      =   tempJSON.sides[enemyNum-1].pokemon[0].lastItem
    simJSON.sides[enemyNum-1].pokemon[pokePos].set.item      =   tempJSON.sides[enemyNum-1].pokemon[0].set.item
    simJSON.sides[enemyNum-1].pokemon[pokePos].set.ability   =   tempJSON.sides[enemyNum-1].pokemon[0].set.ability
    simJSON.sides[enemyNum-1].pokemon[pokePos].set.moves     =   tempJSON.sides[enemyNum-1].pokemon[0].set.moves

    return Battle.fromJSON(simJSON)
}

async function addPokemon(state, poke) {
    let simJSON = state.sim.toJSON()

    //Get the pokemon's data


    let moves = getMoves(poke)
    poke['moves'] = [new Move(gen, moves[0]), new Move(gen, moves[1]), new Move(gen, moves[2]), new Move(gen, moves[3])]
    // enemyTeam[0].abilities = Object.values(gen.dex.species.get(enemyTeam[0].pokemon.name).abilities)
    // enemyTeam[0].items = await generatePossibleItems(enemyTeam[0].pokemon)

    let enemyPack = []
    let newIdx = state.enemyTeam.length
    for (let i=0; i<state.enemyTeam.length; i++) {
        if (state.enemyTeam[i].pokemon)
            enemyPack.push(packPokemon(state.enemyTeam[i].pokemon))
        else
            break
    }
    enemyPack.push(packPokemon(poke))

    enemyPack = Teams.pack(enemyPack)
    let packedTeam = enemyPack

    let battle = new Battle(gen.dex)
    battle.rated = true
    battle.setPlayer(`p${playerNum}`, {team: packedTeam})
    battle.setPlayer(`p${enemyNum}`, {team: enemyPack})

    // Find the first magikarp in the enemy team
    let magikarpIndex = 0
    for (let i=0; i<simJSON.sides[enemyNum-1].pokemon.length; i++) {
        if (simJSON.sides[enemyNum-1].pokemon[i].species === '[Species:magikarp]') {
            magikarpIndex = i
            break
        }
    }

    let tempJSON = battle.toJSON()

    // simJSON.sides[enemyNum-1].pokemonLeft += 1
    simJSON.sides[enemyNum-1].pokemon[magikarpIndex] = tempJSON.sides[enemyNum-1].pokemon[magikarpIndex]
    // let b = simJSON.sides[enemyNum-1].pokemon[0]
    // simJSON.sides[enemyNum-1].pokemon[0] = simJSON.sides[enemyNum-1].pokemon[simJSON.sides[enemyNum-1].pokemon.length-1]
    // simJSON.sides[enemyNum-1].pokemon[simJSON.sides[enemyNum-1].pokemon.length-1] = b

    // simJSON.sides[enemyNum-1].team += (simJSON.sides[enemyNum-1].team.length+1).toString()



    return Battle.fromJSON(simJSON)
}

//todo actually make this function work instead of just being a copy of addPokemon
async function changeMove(state, poke, move, moveNum) {
    let simJSON = state.sim.toJSON()


    //Get the pokemon's data
    let ret = teamSetup()
    let packedTeam = ret['team']
    let pokemon = ret['pokemon']

    let enemyTeam = [new uncertainPokemon(0, createPokemon(poke))]

    enemyTeam[0].pokemon['moves'] = [new Move(gen,'Splash'), new Move(gen, 'Splash'), new Move(gen, 'Splash'), new Move(gen, 'Splash')]
    enemyTeam[0].abilities = Object.values(gen.dex.species.get(poke).abilities)
    enemyTeam[0].items = await generatePossibleItems(enemyTeam[0].pokemon)

    let enemyPack = [packPokemon(enemyTeam[0].pokemon)]

    //var enemyPack = [packPokemon(new Pokemon(gen, 'Scyther'))]
    //enemyPack[0]['moves'] = ['Aerial Ace', 'X-Scissor', 'Swords Dance', 'Quick Attack']
    enemyPack = Teams.pack(enemyPack)

    let battle = new Battle(gen.dex)
    battle.rated = true
    battle.setPlayer(`p${playerNum}`, {team: packedTeam})
    battle.setPlayer(`p${enemyNum}`, {team: enemyPack})

    let tempJSON = battle.toJSON()
    simJSON.sides[enemyNum-1].pokemonLeft += 1
    simJSON.sides[enemyNum-1].pokemon.push(tempJSON.sides[enemyNum-1].pokemon[0])
    let b = simJSON.sides[enemyNum-1].pokemon[0]
    simJSON.sides[enemyNum-1].pokemon[0] = simJSON.sides[enemyNum-1].pokemon[simJSON.sides[enemyNum-1].pokemon.length-1]
    simJSON.sides[enemyNum-1].pokemon[simJSON.sides[enemyNum-1].pokemon.length-1] = b

    simJSON.sides[enemyNum-1].team += (simJSON.sides[enemyNum-1].team.length+1).toString()

    let newSim = Battle.fromJSON(simJSON)
    return newSim
}




//====================================================================================================================//
//
//====================================================================================================================//

function setMoveOutcome(state, hit=[true, true], damages=[0, 0], secondaryControl=[[], []]) {

    // If the move will miss, FORCE IT TO!  Same with if it should hit!
    state.sim.actions.originalHitStepAccuracy = state.sim.actions.hitStepAccuracy
    state.sim.actions.hitStepAccuracy = function(targets, pokemon, move) {
        if (pokemon === state.sim.sides[playerNum-1].active[0]) {
            const hitResults = []
            for (const [i, target] of targets.entries()) {
                hitResults.push(hit)
            }
            return hitResults
        }
        else if (pokemon === state.sim.sides[enemyNum-1].active[0]) {
            const hitResults = []
            for (const [i, target] of targets.entries()) {
                hitResults.push(hit)
            }
            return hitResults
        }
    }

    // Force the damage to be what we want for each side!
    // Modify damage calculation
    state.sim.originalRunMove = state.sim.actions.runMove
    state.sim.actions.runMove = (move, pokemon, targetLoc, moveOptions) => {
        // Intercept damage calculation logic
        const originalGetDamage = state.sim.actions.getDamage;
        state.sim.actions.getDamage = (source, target, move, suppressMessages) => {
            let damage = originalGetDamage.call(state.sim.actions, source, target, move, suppressMessages);
            if (damage) {
                if (source.name === state.sim.sides[playerNum-1].active[0].name) {
                    switch (damages[0]) {
                        case 0:
                            damage *= .85
                            break;
                        case 1:
                            damage *= 1
                            break;
                        case 2:
                            damage *= 1.5*(.85)
                            break;
                        case 3:
                            damage *= 1.5
                            break;
                        default:
                            break;
                    }
                }
                else if (source.name === state.sim.sides[enemyNum-1].active[0].name) {
                    switch (damages[1]) {
                        case 0:
                            damage *= .85
                            break;
                        case 1:
                            damage *= 1
                            break;
                        case 2:
                            damage *= 1.5*(.85)
                            break;
                        case 3:
                            damage *= 1.5
                            break;
                        default:
                            break;
                    }
                }
            }
            return damage;
        };

        const result = state.sim.originalRunMove.call(state.sim.actions, move, pokemon, targetLoc, moveOptions);
        state.sim.actions.getDamage = originalGetDamage; // Restore original damage function
        return result;
    };

    // Force the secondary chance to be what we want for each side!
    state.sim.actions.originalSecondaries = state.sim.actions.secondaries
    state.sim.actions.secondaries = function (targets, source, move, moveData, isSelf) {
        if (!moveData.secondaries) return;
        for (const target of targets) {
            if (target === false) continue;
            const secondaries =
                state.sim.runEvent('ModifySecondaries', target, source, moveData, moveData.secondaries.slice());
            let secondaryCount = 0
            for (const secondary of secondaries) {
                let secondaryRoll = 99
                if (source === state.sim.sides[0].active[0]) {
                    if (secondaryControl[0] && secondaryControl[0][secondaryCount])
                        secondaryRoll = 0
                    else
                        secondaryRoll = 99
                }
                if (source === state.sim.sides[1].active[0]) {
                    if (secondaryControl[1] && secondaryControl[1][secondaryCount])
                        secondaryRoll = 0
                    else
                        secondaryRoll = 99
                }
                // User stat boosts or target stat drops can possibly overflow if it goes beyond 256 in Gen 8 or prior
                const secondaryOverflow = (secondary.boosts || secondary.self) && state.sim.gen <= 8;
                if (typeof secondary.chance === 'undefined' ||
                    secondaryRoll < (secondaryOverflow ? secondary.chance % 256 : secondary.chance)) {
                    state.sim.actions.moveHit(target, source, move, secondary, true, isSelf);
                }
            }
        }
    }
    return state
}

function unsetMoveOutcome(state) {
    state.sim.actions.hitStepAccuracy = state.sim.actions.originalHitStepAccuracy
    state.sim.actions.runMove = state.sim.originalRunMove
    state.sim.actions.secondaries = state.sim.actions.originalSecondaries
    return state
}



async function getSwitchStates(simJSON, side, state, stateAction, stateChance) {
    let switchStates = []
    let switchCount = 0
    let switchActions = []
    let validSwitches = []
    //let simJSON = state.sim.toJSON()


    // AI switches to each available pokemon
    let searchLength
    if (side === playerNum -1)
        searchLength = 6
    else {
        for (let i=0; i< 6; i++) {
            if (state.sim.sides[side].pokemon[i].name === "Magikarp") {
                searchLength = Math.max(2,i)
                break
            }
        }
    }
    for (let i=1; i<searchLength; i++) {
        if(state.sim.sides[side].pokemon[i].status !== 'fnt' && state.sim.sides[side].pokemon[i].hp > 0) {
            const iCopy = i
            switchCount += 1
            await copyState(state, simJSON).then(newState => {
                if (side === playerNum-1) {
                    newState.sim.choose(`p${side+1}`, `switch ${iCopy + 1}`)
                    switchStates.push({state: newState, chance: 1, action: `switch ${iCopy + 1}`})
                }
                else {
                    switchStates.push({state: newState, chance: 1, action: stateAction})
                }
            })
            switchActions.push([false, 0, false])
            validSwitches.push(iCopy+1)
        }
    }
    if(side === enemyNum-1) {
        for (let i = 0; i < switchStates.length; i++) {
            switchStates[i].chance = stateChance * 0.5 / switchCount
        }
    }
    return {switchStates, switchCount, switchActions, validSwitches}
}

async function getAccuracyStates(simJSON, side, state, i, move, stateAction, stateChance) {
    let moveStates = []
    let moveActions = []
    const iCopy = i
    // let simJSON = state.sim.toJSON()
    let acc = move.accuracy === true ? 100 : move.accuracy
    await copyState(state, simJSON).then(newState => {
        if(side === playerNum-1) {
            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
            moveStates.push({state: newState, chance: acc / 100, action: `move ${iCopy + 1}`})
        }
        else {
            moveStates.push({state: newState, chance: stateChance * (0.5/4) * acc / 100, action: stateAction})
        }
        moveActions.push(true)
    })
    //1) Does it have accuracy?  Make an additional state for if it misses
    if (acc !== 100) {
        await copyState(state, simJSON).then(newState => {
            if(side === playerNum-1) {
                newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                moveStates.push({state: newState, chance: 1-acc/100, action: `move ${iCopy + 1}`})
            }
            else {
                moveStates.push({state: newState, chance: stateChance * (0.5/4) * (1-acc/100), action: stateAction})
            }
            moveActions.push(false)
        })
    }
    return {moveStates, moveActions}
}

async function getDamageStates(simJSON, side, state, i, move, moveStates, moveActions, stateAction) {
    let nextMoveStates = []
    let nextMoveActions = []
    // let simJSON = state.sim.toJSON()
    //2) Does it deal damage?  Make a state for min/max damage for both crit and non-crit.  Must calculate the damages later.
    if (move.category !== 'Status') {
        async function stateLoop(simJSON) {
            for(let j=0; j<moveStates.length; j++) {
                if (moveActions[j] === true) {
                    let critChance = move.critRatio ? 1/24*move.critRatio : 1
                    const iCopy = i
                    copyState(state, simJSON).then(newState => {
                        if(side === playerNum-1) {
                            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (1 - critChance) / 2,
                                action: `move ${iCopy + 1}`
                            })
                        }
                        else {
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (1 - critChance) / 2,
                                action: stateAction
                            })
                        }
                        nextMoveActions.push([true, 0])  // 0 = non-crit minimum
                    })
                    copyState(state, simJSON).then(newState => {
                        if(side === playerNum-1) {
                            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (1 - critChance) / 2,
                                action: `move ${iCopy + 1}`
                            })
                        }
                        else {
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (1 - critChance) / 2,
                                action: stateAction
                            })
                        }
                        nextMoveActions.push([true, 1])  // 0 = non-crit maximum
                    })
                    copyState(state, simJSON).then(newState => {
                        if(side === playerNum-1) {
                            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (critChance) / 2,
                                action: `move ${iCopy + 1}`
                            })
                        }
                        else {
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (critChance) / 2,
                                action: stateAction
                            })
                        }
                        nextMoveActions.push([true, 2])  // 2 = crit minimum
                    })
                    copyState(state, simJSON).then(newState => {
                        if(side === playerNum-1) {
                            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (critChance) / 2,
                                action: `move ${iCopy + 1}`
                            })
                        }
                        else {
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance * (critChance) / 2,
                                action: stateAction
                            })
                        }
                        nextMoveActions.push([true, 3])  // 3 = crit maximum
                    })
                }
                else {
                    const iCopy = i
                    copyState(state, simJSON).then(newState => {
                        if(side === playerNum-1) {
                            newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance,
                                action: `move ${iCopy + 1}`
                            })
                        }
                        else {
                            nextMoveStates.push({
                                state: newState,
                                chance: moveStates[j].chance,
                                action: stateAction
                            })
                        }
                        nextMoveActions.push([false, 0])  // 0 = miss
                    })
                }
            }
        }

        await stateLoop(simJSON)
        moveStates = nextMoveStates
        moveActions = nextMoveActions
    }
    else {
        for (let j=0; j<moveStates.length; j++) {
            moveActions[j] = [moveActions[j], 0]
        }
    }
    return {moveStates, moveActions}
}

async function getSecondaryStates(simJSON, side, state, i, move, moveStates, moveActions, stateAction) {
    //3) Does it have a chance for secondary effects? Make a state for each chance of secondary effect
    //let simJSON = state.sim.toJSON()
    if (move.secondaries) {
        async function stateLoop(simJSON) {
            let nextMoveStates = []
            let nextActionStates = []
            for (let j=0; j<move.secondaries.length; j++) {
                if (move.secondaries[j].chance) {

                    for (let k = 0; k < moveStates.length; k++) {
                        if (moveActions[k][0] === true) {
                            const iCopy = i
                            copyState(state, simJSON).then(newState => {
                                if(side === playerNum-1) {
                                    newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                                    nextMoveStates.push({
                                        state: newState,
                                        chance: moveStates[k].chance * move.secondaries[j].chance/100,
                                        action: `move ${iCopy + 1}`
                                    })
                                }
                                else {
                                    nextMoveStates.push({
                                        state: newState,
                                        chance: moveStates[k].chance * move.secondaries[j].chance/100,
                                        action: stateAction
                                    })
                                }
                                nextActionStates.push([true, moveActions[1], true])
                            })
                            copyState(state, simJSON).then(newState => {
                                if(side === playerNum-1) {
                                    newState.sim.choose(`p${side+1}`, `move ${iCopy + 1}`)
                                    nextMoveStates.push({
                                        state: newState,
                                        chance: moveStates[k].chance * (1 - move.secondaries[j].chance/100),
                                        action: `move ${iCopy + 1}`
                                    })
                                }
                                else {
                                    nextMoveStates.push({
                                        state: newState,
                                        chance: moveStates[k].chance * (1 - move.secondaries[j].chance/100),
                                        action: stateAction
                                    })
                                }
                                nextActionStates.push([true, moveActions[1], false])
                            })
                        } else {
                            nextMoveStates.push(moveStates[k])
                            nextActionStates.push([false, moveActions[k][1]], false)
                        }
                    }
                }
            }
            return {moveStates: nextMoveStates, moveActions: nextActionStates}
        }
        return await stateLoop(simJSON)
    }
    else {
        for (let k=0; k<moveStates.length; k++) {
            moveActions[k].push(false)
        }
    }
    return {moveStates, moveActions}
}

async function deterministicUserActions(state, onlySwitch) {
    let simJSON = state.sim.toJSON()

    let switchStates = await getSwitchStates(simJSON, playerNum-1, state)

    let secondaryStates = []
    // Now check all 4 moves

    let allStates = []
    let allActions = []

    if(!onlySwitch) {
        for (let i = 0; i < 4; i++) {
            //Get attributes for the move.
            let move = gen.dex.moves.get(state.sim.sides[playerNum - 1].active[0].moves[i])

            //1) Does it have accuracy?  Make an additional state for if it misses
            let accuracyStates = await getAccuracyStates(simJSON, playerNum - 1, state, i, move)

            //2) Does it deal damage?  Make a state for min/max damage for both crit and non-crit.  Must calculate the damages later.
            let damageStates = await getDamageStates(simJSON, playerNum - 1, state, i, move, accuracyStates.moveStates, accuracyStates.moveActions)

            //3) Does it have a chance for secondary effects? Make a state for each chance of secondary effect
            secondaryStates.push(await getSecondaryStates(simJSON, playerNum - 1, state, i, move, damageStates.moveStates, damageStates.moveActions))
        }



        for (let i = 0; i < switchStates.switchCount; i++) {
            allStates.push(switchStates.switchStates[i])
            allActions.push(switchStates.switchActions[i])
        }
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < secondaryStates[i].moveStates.length; j++) {
                allStates.push(secondaryStates[i].moveStates[j])
                allActions.push(secondaryStates[i].moveActions[j])
            }
        }
    }
    else {
        for (let i = 0; i < switchStates.switchCount; i++) {
            allStates.push(switchStates.switchStates[i])
            allActions.push(switchStates.switchActions[i])
        }
    }

    return {allStates, allActions}
}

async function deterministicOpponentActions(userStates, userActions, onlySwitch){
    let bothStates = []
    let bothActions = []
    let opponentChoices = []

    for(let i=0; i<userStates.length; i++) {
        let simJSON = userStates[i].state.sim.toJSON()

        let switchStates = await getSwitchStates(simJSON, enemyNum-1, userStates[i].state, userStates[i].action, userStates[i].chance)
        let secondaryStates = []
        // Now check all 4 moves

        if (!onlySwitch) {
            for (let j = 0; j < 4; j++) {
                //Get attributes for the move.
                let move = gen.dex.moves.get(userStates[i].state.sim.sides[enemyNum - 1].active[0].moves[j])

                //1) Does it have accuracy?  Make an additional state for if it misses
                let accuracyStates = await getAccuracyStates(simJSON, enemyNum - 1, userStates[i].state, j, move, userStates[i].action, userStates[i].chance)

                //2) Does it deal damage?  Make a state for min/max damage for both crit and non-crit.  Must calculate the damages later.
                let damageStates = await getDamageStates(simJSON, enemyNum - 1, userStates[i].state, j, move, accuracyStates.moveStates, accuracyStates.moveActions, userStates[i].action)

                //3) Does it have a chance for secondary effects? Make a state for each chance of secondary effect
                secondaryStates.push(await getSecondaryStates(simJSON, enemyNum - 1, userStates[i].state, j, move, damageStates.moveStates, damageStates.moveActions, userStates[i].action))
            }

            let allStates = []
            let allActions = []

            for (let j = 0; j < switchStates.switchCount; j++) {
                allStates.push(switchStates.switchStates[j])
                allActions.push(switchStates.switchActions[j])
                opponentChoices.push(`switch ${j + 2}`)
            }
            for (let j = 0; j < 4; j++) {
                for (let k = 0; k < secondaryStates[j].moveStates.length; k++) {
                    allStates.push(secondaryStates[j].moveStates[k])
                    allActions.push(secondaryStates[j].moveActions[k])
                    opponentChoices.push(`move ${j + 1}`)
                }
            }

            for (let j = 0; j < allStates.length; j++) {
                bothStates.push(allStates[j])
                bothActions.push([
                    [userActions[i][0], allActions[j][0]],
                    [userActions[i][1], allActions[j][1]],
                    [userActions[i][2], allActions[j][2]]
                ])
            }
        }
        else {
            for (let j = 0; j < switchStates.switchCount; j++) {
                bothStates.push(switchStates.switchStates[j])
                bothActions.push(switchStates.switchActions[j])
                opponentChoices.push(`switch ${switchStates.validSwitches[j]}`)
            }
        }
    }
    return {bothStates, bothActions, opponentChoices}
}



async function deterministicNextStates(state) {
    let userActions
    let userAndOpponentStates
    let outputs

    // First check for if the user has a force switch
    if(state.sim.sides[playerNum-1].activeRequest && state.sim.sides[playerNum-1].activeRequest.forceSwitch && state.sim.sides[playerNum-1].activeRequest.forceSwitch[0] === true) {
        userActions = await deterministicUserActions(state, true)
        return userActions.allStates
    }
    // else if(state.sim.sides[enemyNum-1].activeRequest && state.sim.sides[enemyNum-1].activeRequest.forceSwitch && state.sim.sides[enemyNum-1].activeRequest.forceSwitch[0] === true) {
    //     userAndOpponentStates = await deterministicOpponentActions([{state:state, chance:1}], [''], true)
    //     for(let i=0; i<userAndOpponentStates.bothStates.length; i++) {
    //         userAndOpponentStates.bothStates[i].state.sim.choose(`p${enemyNum}`, userAndOpponentStates.opponentChoices)
    //     }
    //     return userAndOpponentStates.bothStates
    // }

    else {
        userActions = await deterministicUserActions(state)
        userAndOpponentStates = await deterministicOpponentActions(userActions.allStates, userActions.allActions)

        async function executeActions(state, actionList, enemyAction) {
            await setMoveOutcome(state, actionList[0], actionList[1], actionList[2])
            await state.sim.choose(`p${enemyNum}`, enemyAction)
            await unsetMoveOutcome(state)
            return state
        }

        async function executeActionsLoop(states, actionList, enemyActions) {
            await Promise.all(states.map((state, i) =>
                executeActions(state.state, actionList[i], enemyActions[i]).then(newState => {
                    states[i].state = newState
                    states[i].enemyChoice = enemyActions[i]
                })
            ))
            return states

            //for(let i=0; i<actionList.length; i++) {
            //    states[i].state = executeActions(states[i].state, actionList[i], enemyActions[i])
            //}
            //return states
        }

        outputs = await executeActionsLoop(userAndOpponentStates.bothStates, userAndOpponentStates.bothActions, userAndOpponentStates.opponentChoices)
    }


    // Now complete the actions based on the actions taken
    return outputs
}

//====================================================================================================================//
//
//====================================================================================================================//

function calcChanceCount(move) {
    let chanceCount = 1

    // if(move.category !== 'Status') {
    //     chanceCount *= 1
    // }
    if(move.secondaries) {
        chanceCount *= Math.ceil(Math.log(1.0-.5)/Math.log(.9))
    }
    if(move.accuracy !== true && move.accuracy !== 100) {
        chanceCount *= Math.ceil(Math.log(1.0-.5)/Math.log(move.accuracy/100))
    }


    return chanceCount
}

async function getUserActions(state, simJSON=undefined) {
    let newStates = []

    if (!simJSON)
        //Get JSON of battle state so it isn't needed repeatedly
        simJSON = state.sim.toJSON()

    // AI switches to each available pokemon
    for (let i=1; i<state.sim.sides[playerNum-1].pokemon.length; i++) {
        if(state.sim.sides[playerNum-1].pokemon[i].status !== 'fnt') {
            const iCopy = i
            copyState(state, simJSON).then(newState => {
                newState.sim.choose(`p${playerNum}`, `switch ${iCopy+1}`)
                newStates.push({state: newState, chance: 1, action: `switch ${iCopy+1}`})
            })
        }
    }

    // AI Chooses each move
    for (let i=0; i<4; i++) {
        let chanceCount = calcChanceCount(gen.dex.moves.get(state.sim.sides[playerNum-1].active[0].moves[i]))
        for (let j=0; j<chanceCount; j++) {
            const iCopy = i
            copyState(state, simJSON).then(newState => {
                newState.sim.choose(`p${playerNum}`, `move ${iCopy + 1}`)
                newStates.push({state: newState, chance: 1/chanceCount, action: `move ${iCopy + 1}`})
            })
        }
    }

    return newStates
}

async function getEnemyActions(newStates, state, simJSON=undefined) {
    let allStates = []

    //Get JSON of battle state so it isn't needed repeatedly
    if (!simJSON)
        //Get JSON of battle state so it isn't needed repeatedly
        simJSON = state.sim.toJSON()

    // Do this for each created state
    let actionStates = newStates.length
    for (let s=0; s<actionStates; s++) {
        // Opponent switches to each pokemon
        // Count switch options
        let optionsCount = 0
        for (let i=1; i<newStates[s].state.sim.sides[enemyNum-1].pokemon.length; i++)
            if(newStates[s].state.sim.sides[enemyNum-1].pokemon[i].status !== 'fnt')
                optionsCount += 1

        for (let i=1; i<newStates[s].state.sim.sides[enemyNum-1].pokemon.length; i++) {
            if(newStates[s].state.sim.sides[enemyNum-1].pokemon[i].status !== 'fnt') {
                const iCopy = i
                copyState(newStates[s].state, simJSON).then(newState => {
                    newState.sim.choose(`p${enemyNum}`, `switch ${iCopy+1}`)
                    allStates.push({state: newState, chance: newStates[s].chance*0.5/optionsCount, action: newStates[s].action})
                })
            }
        }

        // for (let i=1; i<newStates[s].state.sim.sides[enemyNum-1].pokemon.length; i++) {
        //     if(newStates[s].state.sim.sides[enemyNum-1].pokemon[i].status !== 'fnt') {
        //         let newState = copyState(newStates[s].state)
        //         newState.sim.choose(`p${enemyNum}`, `switch ${i+1}`)
        //         allStates.push({state: newState, chance: 0.5/optionsCount, action: newStates[s].action})
        //     }
        // }

        // Opponent chooses each move
        for (let i=0; i<4; i++) {
            let chanceCount = calcChanceCount(gen.dex.moves.get(newStates[s].state.sim.sides[enemyNum-1].active[0].moves[i]))
            for (let j=0; j<chanceCount; j++) {
                const iCopy = i
                copyState(newStates[s].state, simJSON).then(newState => {
                    newState.sim.choose(`p${enemyNum}`, `move ${iCopy + 1}`)
                    allStates.push({state: newState, chance: newStates[s].chance*(0.5/4)/chanceCount, action: newStates[s].action})
                })
            }
        }

        // for (let i=0; i<4; i++) {
        //     let chanceCount = calcChanceCount(gen.dex.moves.get(newStates[s].state.sim.sides[enemyNum-1].active[0].moves[i]))
        //     for (let j=0; j<chanceCount; j++) {
        //         let newState = copyState(newStates[s].state)
        //         newState.sim.choose(`p${enemyNum}`, `move ${i + 1}`)
        //         allStates.push({state: newState, chance: 0.5/4, action: newStates[s].action})
        //     }
        // }
    }
    return allStates
}

async function resolvePlayerRequests(allStates, state, simJSON=undefined) {
    //Get JSON of battle state so it isn't needed repeatedly
    if (!simJSON)
        //Get JSON of battle state so it isn't needed repeatedly
        simJSON = state.sim.toJSON()

    let switchedStates = []
    for (let s=0; s<allStates.length; s++) {
        if (allStates[s].state.sim.sides[playerNum-1].activeRequest && allStates[s].state.sim.sides[playerNum-1].activeRequest.forceSwitch && allStates[s].state.sim.sides[playerNum-1].activeRequest.forceSwitch[0] === true) {
            let optionsCount = 0
            for (let i=1; i<allStates[s].state.sim.sides[playerNum-1].pokemon.length; i++)
                if(allStates[s].state.sim.sides[playerNum-1].pokemon[i].status !== 'fnt')
                    optionsCount += 1

            for (let i=1; i<allStates[s].state.sim.sides[playerNum-1].pokemon.length; i++) {
                if(allStates[s].state.sim.sides[playerNum-1].pokemon[i].status !== 'fnt') {
                    const iCopy = i
                    copyState(allStates[s].state, simJSON).then(newState => {
                        newState.sim.choose(`p${playerNum}`, `switch ${iCopy+1}`)
                        switchedStates.push({state: newState, chance: allStates[s].chance/optionsCount, action: allStates[s].action})
                    })
                }
            }
        }
        else
            switchedStates.push(allStates[s])
    }

    return switchedStates
}




async function probabilisticNextStates(state) {
    // let newStates = []
    // Just run every option using the actual sim 25 times.

    // Go based on turns

    // AI switches to each available pokemon

    // for (let i=1; i<state.sim.sides[playerNum-1].pokemon.length; i++) {
    //     if(state.sim.sides[playerNum-1].pokemon[i].status !== 'fnt') {
    //         let newState = copyState(state)
    //         newState.sim.choose(`p${playerNum}`, `switch ${i+1}`)
    //         newStates.push({state: newState, chance: 1, action: `switch ${i+1}`})
    //     }
    // }

    // AI Chooses each move

    // for (let i=0; i<4; i++) {
    //     let chanceCount = calcChanceCount(gen.dex.moves.get(state.sim.sides[playerNum-1].active[0].moves[i]))
    //     for (let j=0; j<chanceCount; j++) {
    //         let newState = copyState(state)
    //         newState.sim.choose(`p${playerNum}`, `move ${i + 1}`)
    //         newStates.push({state: newState, chance: 1, action: `move ${i + 1}`})
    //     }
    // }



    let newStates = await getUserActions(state)

    let allStates = await getEnemyActions(newStates, state)

    let switchedStates = await resolvePlayerRequests(allStates, state)

    // console.log(`Generated ${newStates.length} states`);


    // If a request is open, resolve it.
    let simJSON = state.sim.toJSON()

    let retStates = []
    for (let s=0; s<switchedStates.length; s++) {
        if (switchedStates[s].state.sim.sides[enemyNum-1].activeRequest && switchedStates[s].state.sim.sides[enemyNum-1].activeRequest.forceSwitch && switchedStates[s].state.sim.sides[enemyNum-1].activeRequest.forceSwitch[0] === true) {
            let optionsCount = 0
            for (let i=1; i<switchedStates[s].state.sim.sides[enemyNum-1].pokemon.length; i++)
                if(switchedStates[s].state.sim.sides[enemyNum-1].pokemon[i].status !== 'fnt')
                    optionsCount += 1

            for (let i=1; i<switchedStates[s].state.sim.sides[enemyNum-1].pokemon.length; i++) {
                if(switchedStates[s].state.sim.sides[enemyNum-1].pokemon[i].status !== 'fnt') {
                    const iCopy = i
                    copyState(switchedStates[s].state, simJSON).then(newState => {
                        newState.sim.choose(`p${enemyNum}`, `switch ${iCopy+1}`)
                        retStates.push({state: newState, chance: switchedStates[s].chance/optionsCount, action: switchedStates[s].action})
                    })
                }
            }
        }
        else
            retStates.push(switchedStates[s])
    }



    return retStates
}


async function lookahead(state, newState, depth, i) {
    //console.log(`${depth} ${i}`)
    console.log(`\r${progress}/${maxProgress}`)
    return treeSearch(newState, depth - 1).then(valueActionPair => {
        let value = valueActionPair.bestValue*newState.chance
        let r = state.state.calc_reward()*state.chance
        value = value * 0.8 + r

        return {value: value, action: newState.action}
    })
}

async function lookaheadAll(state, newStates, depth) {
    const lookaheadPromises = newStates.map((newState, i) => lookahead(state, newState, depth, i))

    // Wait for promises to resolve
    const results = await Promise.all(lookaheadPromises)

    let actionValues = {}
    for (const result of results) {
        if (actionValues[result.action]) {
            actionValues[result.action] += result.value;
        } else {
            actionValues[result.action] = result.value;
        }
    }

    return actionValues;
}

async function lookaheadAllOld(state, newStates, depth) {

    let actionValues = {}
    for (let i=0; i<newStates.length; i++) {
        lookahead(state, newStates[i], depth, i).then(valueActionPair => {
            if(actionValues[newStates[i].action]) {
                actionValues[newStates[i].action] += valueActionPair.value
            }
            else {
                actionValues[newStates[i].action] = valueActionPair.value
            }
        })
    }
    return actionValues
}

async function treeSearch(state, depth) {
    if (depth === 2)
        console.log('Depth 2')
    if (depth === 0) {
        let value
        try {
            value = state.state.calc_reward()
        }
        catch (e) {
            console.log('Error')
            console.log(state)
        }
        progress += 1
        return {bestValue: value, bestAction: ''}
    }
    else {
        let allStates = await deterministicNextStates(state.state)
        let newStates = []
        for (let i=0; i<allStates.length; i++) {
            let toAdd = true
            if (newStates.length === 0)
                newStates.push(allStates[i])
            else {
                for (let j = 0; j < newStates.length; j++) {
                    if (allStates[i].action === newStates[j].action && allStates[i].state.checkEqual(newStates[j].state)) {
                        toAdd = false
                        newStates[j].chance += allStates[i].chance
                        break
                    }
                }
                if (toAdd)
                    newStates.push(allStates[i])
            }
        }
        maxProgress += newStates.length
        console.log(`Generated ${allStates.length} states, using ${newStates.length} unique states`);

        // let actionGrouped = {}
        // let actionWeights = {}
        // for (let i=0; i<newStates.length; i++) {
        //     if(isNaN(newStates[i].chance))
        //         console.log('Error')
        //     if (actionGrouped[newStates[i].action]) {
        //         actionGrouped[newStates[i].action].push(newStates[i])
        //         actionWeights[newStates[i].action].push(newStates[i].chance)
        //     }
        //     else {
        //         actionGrouped[newStates[i].action] = [newStates[i]]
        //         actionWeights[newStates[i].action] = [newStates[i].chance]
        //     }
        // }
        // function weightedSamples(items, weights) {
        //     let i
        //     for (i = 1; i< weights.length; i++)
        //         weights[i] += weights[i-1]
        //     let random = Math.random() * weights[weights.length-1];
        //     for (i=0; i<weights.length; i++)
        //         if (weights[i] > random)
        //             break;
        //     return i
        // }
        // let chosenStates = []
        // let stateCounts = {}
        // for (const action of Object.keys(actionGrouped)) {
        //     stateCounts[action] = Math.max(Math.ceil(Math.log2(actionGrouped[action].length)), 1)
        // }
        // for (const action of Object.keys(actionGrouped)) {
        //     for (let i=0; i<stateCounts[action]; i++) {
        //         let index = weightedSamples(actionGrouped[action], actionWeights[action])
        //         chosenStates.push(actionGrouped[action][index])
        //         actionGrouped[action].splice(index, 1)
        //         actionWeights[action].splice(index, 1)
        //         if (chosenStates[chosenStates.length-1] === undefined) {
        //             console.log('Error')
        //         }
        //     }
        // }
        // if(chosenStates.length === 0) {
        //     console.log('No states chosen')
        //     return {bestValue: -Infinity, bestAction: ''}
        // }
        // console.log(`Randomly Chosen ${chosenStates.length} states\n`);
        // newStates = chosenStates



        const actionValues = await lookaheadAll(state, newStates, depth)
        let bestValue = -Infinity
        let bestAction = ''
        for (const action of Object.keys(actionValues)) {
            if (actionValues[action] > bestValue) {
                bestValue = actionValues[action]
                bestAction = action
            }
        }
        return {bestValue, bestAction}
    }
}


async function treeSearchOldAsync(state, depth) {
    if (depth === 0) {
        let value = state.state.calc_reward()
        return {bestValue: value, bestAction: ''}
    }
    else {
        let newStates = await probabilisticNextStates(state.state)
        lookaheadAll(state, newStates, depth).then(actionValues => {
            let bestValue = -Infinity
            let bestAction = ''
            for (const action of Object.keys(actionValues)) {
                if (actionValues[action] > bestValue) {
                    bestValue = actionValues[action]
                    bestAction = action
                }
            }
            return {bestValue, bestAction}
        })
    }
}

async function treeSearchOld(state, depth) {
    if (depth === 0) {
        let value = state.state.calc_reward()
        return {bestValue: value, bestAction: ''}
    }
    else {
        let newStates = await probabilisticNextStates(state.state)
        let actionValues = {}
        for (let i=0; i<newStates.length; i++) {
            console.log(`${depth} ${i}`)
            let valueActionPair = (await treeSearch(newStates[i], depth - 1))
            let value = valueActionPair.bestValue*newStates[i].chance
            let r = state.state.calc_reward()*state.chance
            value = value * 0.8 + r

            if(actionValues[newStates[i].action]) {
                actionValues[newStates[i].action] += value
            }
            else {
                actionValues[newStates[i].action] = value
            }
        }

        let bestValue = -Infinity
        let bestAction = ''
        for (const action of Object.keys(actionValues)) {
            if (actionValues[action] > bestValue) {
                bestValue = actionValues[action]
                bestAction = action
            }
        }
        return {bestValue, bestAction}
    }
}






async function loop() {

}

function askQuestion(query) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function handleOpponentSwitch(state, logAction, logDet) {
    let switchPos

    // Check if the switch was to a known pokemon
    for (let j = 1; j< state.sim.sides[enemyNum-1].pokemon.length; j++) {
        if (state.sim.sides[enemyNum-1].pokemon[j].name.includes(logAction[1].substr(5))) {
            switchPos = j
            break
        }
        else if(state.sim.sides[enemyNum-1].pokemon[j].name === "Magikarp") {
            let poke = new Pokemon(gen, logAction[1].slice(5), {
                nature: 'Hardy',
                level: Number(logAction[2].slice(logAction[1].slice(5).length+3)),
                evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
            })

            state.sim = await addPokemon(state, poke)

            state.enemyTeam[j].pokemon = poke
            switchPos = j
            break
        }
    }
    // Check dets for any information about the pokemon's ability
    if (logDet.length > 0) {
        for (let j=0; j<logDet.length; j++) {
            if (logDet[j][2].substr(7, 7) === 'ability') {
                let ability = logDet[j][2].slice(16)
                state.sim = await changePokemon(state, switchPos, ability)
            }
        }
    }

    // Perform the switch in the state
    state.sim.choose(`p${enemyNum}`, `switch ${switchPos+1}`)


    // Perform the switch in the simulator
    let pokeHold = state.enemyTeam[0]
    state.enemyTeam[0] = state.enemyTeam[switchPos]
    state.enemyTeam[switchPos] = pokeHold

    let movesHold = state.enemyMovesKnown[0]
    state.enemyMovesKnown[0] = state.enemyMovesKnown[switchPos]
    state.enemyMovesKnown[switchPos] = movesHold

    return state
}

async function handleUserSwitch(state, logAction, logDet, choose=true) {
    let switchPos
    for (let j=1; j<state.team.length; j++) {
        if (state.team[j].name.includes(logAction[1].substr(5))) {
            switchPos = j
            break
        }
    }

    if(switchPos === undefined) {
        console.log("what the fuck?")
    }

    let pokeHold = state.team[0]
    state.team[0] = state.team[switchPos]
    state.team[switchPos] = pokeHold

    if (choose) {
        state.sim.choose(`p${playerNum}`, `switch ${switchPos + 1}`)
        return state
    }
    else
        return switchPos+1
}

async function handleOpponentAttack(state, logAction, logDet) {
    let move = logAction[2]
    let moveNum

    //Check if the move is known
    for (let i=0; i<state.enemyMovesKnown[0]; i++) {
        try {
            if (state.sim.sides[enemyNum - 1].active[0].moves[i].toUpperCase().replace(/\s/g, '') === move.toUpperCase().replace(/\s/g, '')) {
                moveNum = i
                break
            }
        }
        catch(e) {
            console.log("uhhhh")
        }
    }

    //If move unknown, track it
    if(!moveNum) {
        moveNum = state.enemyMovesKnown[0]
        state.enemyMovesKnown[0] += 1

        state.enemyTeam[0].moves.push(move)
        // moveNum = state.enemyTeam[0].moves.length-1
        state.sim = await changePokemon(state, 0, undefined, undefined, state.enemyTeam[0].moves)
    }

    state.sim.choose(`p${enemyNum}`, `move ${moveNum+1}`)
    return state

}

async function handleUserAttack(state, logAction, logDet) {
    let move = logAction[2]

    try {
        for (let i = 0; i < state.team[0].moves.length; i++) {
            if (state.team[0].moves[i].name === move) {
                return i + 1
            }
        }
    } catch (e) {
        console.log(e)
    }
}


function makeDamageHandler(trueDamage) {
    return function (damage, source, target, move) {
        return trueDamage
    }
}


// Just live with the fact that this will likely drift from the actual game state.  At least damage, boosts, status are controlled.  Items and abilities being unknown will cause drift
async function resolveTrueState(state, prevLogLength=0) {
    let logString = await readFile('battleLog', 'utf8')
    let logArray = JSON.parse(logString)
    let parsedLogs = processLogs(logArray)

    // parsedLogs = parsedLogs.slice(prevLogLength)

    for (let i=0; i<parsedLogs.length; i++) {
        let log = parsedLogs[i]


        switch (log.actions.length) {
            case 1:
                // Forced actions, usually switches

                // Check if this is a switch
                if (log.actions[0][0] === "switch") {
                    //Check if the opponent switched
                    if (log.actions[0][1][1] === `${enemyNum}`)
                        state = await handleOpponentSwitch(state, log.actions[0], log.dets[0])

                    //If the user switched
                    else
                        state = await handleUserSwitch(state, log.actions[0], log.dets[0])
                }

                break

            case 3: // Something fainted
                let faintedNum
                for (let j=0; j<log.actions.length; j++) {
                    if (log.actions[j][0] === "faint") {
                        log.actions.splice(j,j)
                        log.dets.splice(j,j)
                        break
                    }
                }
                // Now treat as case 2




            case 2:
                // Both sides move.
                let opponentSwitched = false

                // Reorder actions so that the user's is always 0.
                if (log.actions[0][1][1] === `${enemyNum}`) {
                    let tempAction = log.actions[0]
                    let tempDet = log.dets[0]
                    log.actions[0] = log.actions[1]
                    log.dets[0] = log.dets[1]
                    log.actions[1] = tempAction
                    log.dets[1] = tempDet
                }

                if(prevLogLength === 0 && i === 0) {
                    if (log.dets[0].length > 0) {
                        for (let k = 0; k < log.dets[0].length; k++) {
                            if (log.dets[0][k][2] &&log.dets[0][k][2].substr(7, 7) === 'ability') {
                                let ability = log.dets[0][k][2].slice(16)
                                state.sim = await changePokemon(state, 0, ability)
                                state.sim.runEvent('Start', state.sim.sides[enemyNum-1].active[0], null, state.sim.sides[enemyNum-1].ability)
                            }
                        }
                    }
                    continue
                }

                //Check if opponent switched
                if (log.actions[1][0] === "switch") {
                    state = await handleOpponentSwitch(state, log.actions[1], log.dets[1])
                    opponentSwitched = true
                }

                //Check if opponent attacked
                if (log.actions[1][0] === "move") {
                    state = await handleOpponentAttack(state, log.actions[1], log.dets[1])
                }
                //Check if opponent fainted
                else if(log.actions[1][0] === "faint") {
                    state.sim.choose(`p${enemyNum}`, 'move 1')
                }

                //Check if user switched
                let switchNum
                if (log.actions[0][0] === "switch") {
                    switchNum = await handleUserSwitch(state, log.actions[0], log.dets[0], false)
                }

                // Check if user attacked
                let moveNum
                if (log.actions[0][0] === "move") {
                    moveNum = await handleUserAttack(state, log.actions[0], log.dets[0])
                }
                // Check if opponent fainted
                else if(log.actions[1][0] === "faint") {
                    moveNum = 1
                }

                // Perform the actual actions
                // Copy state before making changes
                let oldState = await copyState(state)

                // Override outgoing damage
                let damageDealt = -1
                for (let j=0; j<log.dets[0].length; j++) {
                    if (log.dets[0][j][0] === "-damage" && log.dets[0][j][1][1] === `${enemyNum}`) {
                         damageDealt = Number(log.dets[0][j][2].substr(0, log.dets[0][j][2].indexOf('/')))
                    }
                }
                if (damageDealt > -1) {
                     damageDealt = state.sim.sides[enemyNum-1].active[0].hp-(Math.round(state.sim.sides[enemyNum-1].active[0].maxhp * (damageDealt/100)))
                }

                // Override incoming damage
                let damageTaken = -1
                for (let j=0; j<log.dets[1].length; j++) {
                    if (log.dets[1][j][0] === "-damage" && log.dets[1][j][1][1] === `${playerNum}`) {
                        damageTaken = Number(log.dets[1][j][2].substr(0, log.dets[1][j][2].indexOf('/')))
                    }
                }
                if (damageTaken > -1) {
                    damageTaken = state.sim.sides[playerNum-1].active[0].hp-damageTaken
                }

                // Also check for any recoil damage
                let damageTakenRecoil = -1
                for (let j=0; j<log.dets[0].length; j++) {
                    if (log.dets[0][j][0] === "-damage" && log.dets[0][j][1][1] === `${playerNum}`) {
                        damageTakenRecoil = Number(log.dets[0][j][2].substr(0, log.dets[0][j][2].indexOf('/')))
                    }
                }
                if (damageTakenRecoil > -1) {
                    damageTakenRecoil = state.sim.sides[playerNum-1].active[0].hp-(Math.round(state.sim.sides[playerNum-1].active[0].maxhp * (damageTakenRecoil/100)))
                }
                if (damageTakenRecoil > damageTaken)
                    damageTaken = damageTakenRecoil

                if (damageTaken === -1)
                    damageTaken = 0
                if (damageDealt === -1)
                    damageDealt = 0

                setMoveOutcome(state, [true, true], [damageDealt, damageTaken])




                const originalDamage = state.sim.damage;
                state.sim.damage = (damage, target, source, effect) => {
                    // try {
                    //     console.log(source.name)
                    // }
                    // catch(e) {
                    //     console.log(e)
                    // }
                    if (!source)
                        return 0
                    if (source.name === state.sim.sides[playerNum-1].active[0].name) {
                        return originalDamage.call(state.sim, damageDealt, target, source, effect)
                    }
                    else if(source.name === state.sim.sides[enemyNum-1].active[0].name) {
                        return originalDamage.call(state.sim, damageTaken, target, source, effect)
                    }
                    return originalDamage.call(state.sim, damage, target, source, effect)
                }

                state.sim.originalRunAction = state.sim.runAction;

                state.sim.runAction = function(action) {
                const pokemonOriginalHP = action.pokemon?.hp;
                const residualPokemon = this.getAllActive().map(pokemon => [pokemon, pokemon.getUndynamaxedHP()]);
                switch (action.choice) {
                    case 'move':
                        if (!action.pokemon.isActive) return false;
                        if (action.pokemon.fainted) return false;

                        //Modify damage calculation
                        const originalRunMove = this.actions.runMove
                        this.actions.runMove = (move, pokemon, targetLoc, moveOptions) => {
                            // Intercept damage calculation logic
                            const originalGetDamage = this.actions.getDamage;
                            this.actions.getDamage = (source, target, move, suppressMessages) => {
                                let damage = originalGetDamage.call(this.actions, source, target, move, suppressMessages);
                                if (damage) {
                                    if (source.name === state.sim.sides[playerNum-1].active[0].name) {
                                        damage = damageDealt
                                    }
                                    else if (source.name === state.sim.sides[enemyNum-1].active[0].name) {
                                        damage = damageTaken
                                    }
                                }
                                return damage;
                            };

                            const result = originalRunMove.call(this.actions, move, pokemon, targetLoc, moveOptions);
                            this.actions.getDamage = originalGetDamage; // Restore original damage function
                            return result;
                        };

                        this.actions.runMove(action.move, action.pokemon, action.targetLoc, {
                            sourceEffect: action.sourceEffect,
                            zMove: action.zmove,
                            maxMove: action.maxMove,
                            originalTarget: action.originalTarget,
                        });

                        this.actions.runMove = originalRunMove; // Restore original runMove function
                        break;

                    case 'residual':
                        this.add('');
                        this.clearActiveMove(true);
                        this.updateSpeed();

                        this.residualEvent('Residual');
                        this.add('upkeep');

                        // Emergency Exit logic
                        if (this.gen >= 5) {
                            for (const [pokemon, originalHP] of residualPokemon) {
                                const maxhp = pokemon.getUndynamaxedHP(pokemon.maxhp);
                                if (pokemon.hp && pokemon.getUndynamaxedHP() <= maxhp / 2 && originalHP > maxhp / 2) {
                                    this.runEvent('EmergencyExit', pokemon);
                                }
                            }
                        }
                        break;

                    default:
                        // Pass through other cases unchanged
                        return state.sim.originalRunAction(action);
                }

                // phazing (Roar, etc)
                for (const side of this.sides) {
                    for (const pokemon of side.active) {
                        if (pokemon.forceSwitchFlag) {
                            if (pokemon.hp) this.actions.dragIn(pokemon.side, pokemon.position);
                            pokemon.forceSwitchFlag = false;
                        }
                    }
                }

                this.clearActiveMove();

                // fainting

                this.faintMessages();
                if (this.ended) return true;

                // switching (fainted pokemon, U-turn, Baton Pass, etc)

                if (!this.queue.peek() || (this.gen <= 3 && ['move', 'residual'].includes(this.queue.peek().choice))) {
                    // in gen 3 or earlier, switching in fainted pokemon is done after
                    // every move, rather than only at the end of the turn.
                    this.checkFainted();
                } else if (['megaEvo', 'megaEvoX', 'megaEvoY'].includes(action.choice) && this.gen === 7) {
                    this.eachEvent('Update');
                    // In Gen 7, the action order is recalculated for a Pokémon that mega evolves.
                    for (const [i, queuedAction] of this.queue.list.entries()) {
                        if (queuedAction.pokemon === action.pokemon && queuedAction.choice === 'move') {
                            this.queue.list.splice(i, 1);
                            queuedAction.mega = 'done';
                            this.queue.insertChoice(queuedAction, true);
                            break;
                        }
                    }
                    return false;
                } else if (this.queue.peek()?.choice === 'instaswitch') {
                    return false;
                }

                if (this.gen >= 5) {
                    this.eachEvent('Update');
                    for (const [pokemon, originalHP] of residualPokemon) {
                        const maxhp = pokemon.getUndynamaxedHP(pokemon.maxhp);
                        if (pokemon.hp && pokemon.getUndynamaxedHP() <= maxhp / 2 && originalHP > maxhp / 2) {
                            this.runEvent('EmergencyExit', pokemon);
                        }
                    }
                }

                if (action.choice === 'runSwitch') {
                    const pokemon = action.pokemon;
                    if (pokemon.hp && pokemon.hp <= pokemon.maxhp / 2 && pokemonOriginalHP > pokemon.maxhp / 2) {
                        this.runEvent('EmergencyExit', pokemon);
                    }
                }

                const switches = this.sides.map(
                    side => side.active.some(pokemon => pokemon && !!pokemon.switchFlag)
                );

                for (let i = 0; i < this.sides.length; i++) {
                    let reviveSwitch = false; // Used to ignore the fake switch for Revival Blessing
                    if (switches[i] && !this.canSwitch(this.sides[i])) {
                        for (const pokemon of this.sides[i].active) {
                            if (this.sides[i].slotConditions[pokemon.position]['revivalblessing']) {
                                reviveSwitch = true;
                                continue;
                            }
                            pokemon.switchFlag = false;
                        }
                        if (!reviveSwitch) switches[i] = false;
                    } else if (switches[i]) {
                        for (const pokemon of this.sides[i].active) {
                            if (pokemon.hp && pokemon.switchFlag && pokemon.switchFlag !== 'revivalblessing' &&
                                !pokemon.skipBeforeSwitchOutEventFlag) {
                                this.runEvent('BeforeSwitchOut', pokemon);
                                pokemon.skipBeforeSwitchOutEventFlag = true;
                                this.faintMessages(); // Pokemon may have fainted in BeforeSwitchOut
                                if (this.ended) return true;
                                if (pokemon.fainted) {
                                    switches[i] = this.sides[i].active.some(sidePokemon => sidePokemon && !!sidePokemon.switchFlag);
                                }
                            }
                        }
                    }
                }

                for (const playerSwitch of switches) {
                    if (playerSwitch) {
                        this.makeRequest('switch');
                        return true;
                    }
                }

                if (this.gen < 5) this.eachEvent('Update');

                if (this.gen >= 8 && (this.queue.peek()?.choice === 'move' || this.queue.peek()?.choice === 'runDynamax')) {
                    // In gen 8, speed is updated dynamically so update the queue's speed properties and sort it.
                    this.updateSpeed();
                    for (const queueAction of this.queue.list) {
                        if (queueAction.pokemon) this.getActionSpeed(queueAction);
                    }
                    this.queue.sort();
                }

                return false;
            }




                // Finalize Choices
                if (switchNum)
                    state.sim.choose(`p${playerNum}`, `switch ${switchNum}`)
                else
                    state.sim.choose(`p${playerNum}`, `move ${moveNum}`)


                unsetMoveOutcome(state)
                state.sim.damage = originalDamage
                state.sim.runAction = state.sim.originalRunAction


                // Handle Damages
                // Handle User Outgoing Attack Damage
                // if (moveNum) {
                //     let enemyDamagePerc
                //     let selfDamage
                //
                //     //todo: Assumes that the active pokemon is the one that took damage.  Look up actual pokemon from the thing on the team to correctly deal damage
                //     for (let j=0; j<log.dets[0].length; j++) {
                //         if (log.dets[0][j][0] === "-damage" && log.dets[0][j][1][1] === `${enemyNum}`) {
                //             enemyDamagePerc = Number(log.dets[0][j][2].substr(0, log.dets[0][j][2].indexOf('/')))
                //         }
                //         else if(log.dets[0][j][0] === "-damage" && log.dets[0][j][1][1] === `${playerNum}`) {
                //             selfDamage = Number(log.dets[0][j][2].substr(0, log.dets[0][j][2].indexOf('/')))
                //         }
                //     }
                //     if (enemyDamagePerc) {
                //         state.sim.sides[enemyNum-1].active[0].sethp(Math.round(state.sim.sides[enemyNum-1].active[0].maxhp * enemyDamagePerc))
                //     }
                //     if (selfDamage) {
                //         state.sim.sides[playerNum-1].active[0].sethp(selfDamage)
                //     }
                // }
                //
                //
                // // Handle Enemy Outgoing Damage
                // if (!opponentSwitched) {
                //     let enemyDamagePerc
                //     let selfDamage
                //
                //     //Assumes that the active pokemon is the one that took damage
                //     for (let j=0; j<log.dets[1].length; j++) {
                //         if (log.dets[1][j][0] === "-damage" && log.dets[1][j][1][1] === `${enemyNum}`) {
                //             enemyDamagePerc = Number(log.dets[1][j][2].substr(0, log.dets[1][j][2].indexOf('/')))
                //         }
                //         else if(log.dets[1][j][0] === "-damage" && log.dets[1][j][1][1] === `${playerNum}`) {
                //             selfDamage = Number(log.dets[1][j][2].substr(0, log.dets[1][j][2].indexOf('/')))
                //         }
                //     }
                //     if (enemyDamagePerc) {
                //         if (Math.round(state.sim.sides[enemyNum-1].active[0].maxhp * enemyDamagePerc) < state.sim.sides[enemyNum-1].active[0].hp)
                //             state.sim.sides[enemyNum-1].active[0].sethp(Math.round(state.sim.sides[enemyNum-1].active[0].maxhp * enemyDamagePerc))
                //     }
                //     if (selfDamage) {
                //         if (selfDamage < state.sim.sides[playerNum-1].active[0].hp)
                //             state.sim.sides[playerNum-1].active[0].sethp(selfDamage)
                //     }
                // }
                // Undo any incorrect faints
                /*// For the user
                if (state.sim.sides[playerNum-1].active[0].hp > 0 && state.sim.sides[playerNum-1].active[0].fainted) {
                    state.sim.sides[playerNum-1].active[0].fainted = false
                    state.sim.sides[playerNum-1].active[0].status = '';

                    const index = state.sim.faintQueue.indexOf(state.sim.sides[playerNum-1].active[0]);
                    if (index > -1) {
                        state.sim.faintQueue.splice(index, 1);
                    }
                    state.sim.sides[playerNum-1].pokemonLeft += 1;
                }
                // For the opponent
                if (state.sim.sides[enemyNum-1].active[0].hp > 0 && state.sim.sides[enemyNum-1].active[0].fainted) {
                    state.sim.sides[enemyNum-1].active[0].fainted = false
                    state.sim.sides[enemyNum-1].active[0].status = '';

                    const index = state.sim.faintQueue.indexOf(state.sim.sides[enemyNum-1].active[0]);
                    if (index > -1) {
                        state.sim.faintQueue.splice(index, 1);
                    }
                    state.sim.sides[enemyNum-1].pokemonLeft += 1;
                }

                // Correctly faint pokemon that should be fainted
                if (state.sim.sides[playerNum-1].active[0].hp <= 0 && !state.sim.sides[playerNum-1].active[0].fainted) {
                    state.sim.faint(state.sim.sides[playerNum-1].active[0])
                    state.sim.cancelRequest()
                }
                if (state.sim.sides[enemyNum-1].active[0].hp <= 0 && !state.sim.sides[enemyNum-1].active[0].fainted) {
                    state.sim.faint(state.sim.sides[enemyNum-1].active[0])
                }


                // Handle Status Changes
                // Handle User Status Changes
                //First set to what it was before
                state.sim.sides[playerNum-1].active[0].status = oldState.sim.sides[playerNum-1].active[0].status
                //Now look at any status dets
                for (let j=0; j<log.dets[0].length; j++) {
                    if (log.dets[0][j][0] === "-status") {
                        state.sim.sides[playerNum-1].active[0].status = log.dets[0][j][1][1]
                    }
                }*/

                // Handle Boost Changes
                // Handle User Boost Changes
                // First set to what it was before
                for(let j=0; j<6; j++) {
                    state.sim.sides[playerNum-1].active[0].boosts[j] = oldState.sim.sides[playerNum-1].active[0].boosts[j]
                }
                // Now look at any boost dets
                for (let j=0; j<log.dets[0].length; j++) {
                    if (log.dets[0][j][0] === "-boost") {
                        // Only do boosts on active pokemon
                        if (log.dets[0][j][1].includes(state.sim.sides[playerNum-1].active[0].name)) {
                            let stat = log.dets[0][j][2]
                            let amount = Number(log.dets[0][j][3])
                            state.sim.sides[playerNum - 1].active[0].boosts[stat] += amount
                        }
                    }
                }

                // Repeat for the opponent
                // First set to what it was before
                for(let j=0; j<6; j++) {
                    state.sim.sides[enemyNum-1].active[0].boosts[j] = oldState.sim.sides[enemyNum-1].active[0].boosts[j]
                }
                // Now look at any boost dets
                for (let j=0; j<log.dets[1].length; j++) {
                    if (log.dets[1][j][0] === "-boost") {
                        // Only do boosts on active pokemon
                        if (log.dets[1][j][1].includes(state.sim.sides[enemyNum-1].active[0].name)) {
                            let stat = log.dets[1][j][2]
                            let amount = Number(log.dets[1][j][3])
                            state.sim.sides[enemyNum - 1].active[0].boosts[stat] += amount
                        }
                    }
                }

                // Handle Status Changes
                // Handle User Status Changes
                // First set to what it was before
                state.sim.sides[playerNum-1].active[0].status = oldState.sim.sides[playerNum-1].active[0].status
                // Now look at any status dets
                for (let j=0; j<log.dets[0].length; j++) {
                    if (log.dets[0][j][0] === "-status") {
                        state.sim.sides[playerNum-1].active[0].status = log.dets[0][j][2]
                    }
                }

                // Repeat for the opponent
                // First set to what it was before
                state.sim.sides[enemyNum-1].active[0].status = oldState.sim.sides[enemyNum-1].active[0].status
                // Now look at any status dets
                for (let j=0; j<log.dets[1].length; j++) {
                    if (log.dets[1][j][0] === "-status") {
                        state.sim.sides[enemyNum-1].active[0].status = log.dets[1][j][2]
                    }
                }
        }
    }
    return {state: state, logLen: parsedLogs.length}
}


async function selfPlay() {
    const teamGenerator = TeamGenerators.getTeamGenerator('gen9randombattle')

    playerNum = 1
    enemyNum = 2

    const team1 = teamGenerator.getTeam()
    const team2 = teamGenerator.getTeam()

    console.log(team1)
    console.log(team2)

    const enemyFirst = new uncertainPokemon(0, new Pokemon(gen, team2[0].name, {
        nature: 'Hardy',
        level: team2[0].level,
        evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
    }))

    let state = await stateSetup(team1, enemyFirst, false, team2)

    let logLen = 0
    while(true) {
        progress = 0
        maxProgress = 1
        console.log(`${state[0].state.sim.sides[0].active[0].name} :: ${state[0].state.sim.sides[0].active[0].hp}/${state[0].state.sim.sides[0].active[0].maxhp}`)
        console.log(`${state[0].state.sim.sides[1].active[0].name} :: ${state[0].state.sim.sides[1].active[0].hp}/${state[0].state.sim.sides[1].active[0].maxhp}`)

        console.log(state[0].state.sim.sides[1].requestState)
        if (state[0].state.sim.sides[0].requestState === "move") {
            console.log("\nMoves: ")
            console.log(`${1}: ${state[0].state.sim.sides[1].active[0].moves[0]}`)
            console.log(`${2}: ${state[0].state.sim.sides[1].active[0].moves[1]}`)
            console.log(`${3}: ${state[0].state.sim.sides[1].active[0].moves[2]}`)
            console.log(`${4}: ${state[0].state.sim.sides[1].active[0].moves[3]}`)

            console.log("\nSwitches")
            for(let i=1; i<state[0].state.sim.sides[1].pokemon.length; i++) {
                if(state[0].state.sim.sides[1].pokemon[i].hp !== 0) {
                    console.log(`${i+1}: ${state[0].state.sim.sides[1].pokemon[i].name}`)
                }
            }
        }
        else if (state[0].state.sim.sides[1].requestState === "switch") {
            console.log("\nSwitches")
            console.log(`${1}: ${state[0].state.sim.sides[1].pokemon[0].name}`)
            for(let i=1; i<state[0].state.sim.sides[1].pokemon; i++) {
                if(state[0].state.sim.sides[1].pokemon[i].condition === "0 fnt") {
                    console.log(`${i+1}: ${state[0].state.sim.sides[1].pokemon[i].name}`)
                }
            }
        }
        let inpt = await askQuestion('Choice: ')
        if (inpt === 'n')
            break

        let trueState = await cloneDeep(state[0])

        let runState = {state:trueState.state, chance:1}
        let res = await treeSearch(runState, 2)

        console.log(res)

        state[0].state.sim.choose(`p${playerNum}`, res.bestAction)
        state[0].state.sim.choose(`p${enemyNum}`, inpt)



        for (let i = logLen; i<state[0].state.sim.log.length; i++) {
            console.log(state[0].state.sim.log[i])
        }
        logLen = state[0].state.sim.log.length

    }
}

async function main() {
    await selfPlay()
    let logsProc = systemSetup()

    let teamString = await readFile('teamInpt', 'utf8')
    // await readFile('teamInpt', 'utf8', (err, data) => {
    //     if (err) {
    //         console.error(err)
    //         return ''
    //     }
    //     else
    //         teamString = data
    // })

    const pnum = await askQuestion('What is the player number? ')
    if (pnum === '1') {
        playerNum = 1
        enemyNum = 2
    }
    else {
        playerNum = 2
        enemyNum = 1
    }
    const enemyFirstSpecies = await askQuestion('What is the first enemy pokemon? ')
    const enemyFirstLevel = await askQuestion('What is the first enemy pokemon\'s level? ')


    const enemyFirst = new uncertainPokemon(0, new Pokemon(gen, enemyFirstSpecies, {
        nature: 'Hardy',
        level: enemyFirstLevel,
        evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
    }))


    let states = await stateSetup(teamString, enemyFirst, false)
    let baseState = await copyState(states[0].state)

    // states[0].state.sim = await addPokemon(states[0].state, new Pokemon(gen, 'Incineroar', {
    //     nature: 'Hardy',
    //     level: 97,
    //     evs: {hp:85, atk:85, def: 85, spa:85, spd:85, spe:85},
    // }))


    // states[0].state.sim = await changePokemon(states[0].state, 0, 'Intimidate', 'Assault Vest', ['Flare Blitz', 'Darkest Lariat', 'U-turn'])
    // states[0].state = changePokemon(states[0].state, states[0].state.sim.sides[enemyNum-1].pokemon[0], 0, 'Intimidate', ['Thunder Wave', 'Thunderbolt'])

    // checkPokemonEquality(states[0].state.sim.sides[playerNum-1].pokemon[0], states[0].state.sim.sides[playerNum-1].pokemon[0])

    //Check volatiles
    //states[0].state.sim.sides[playerNum-1].pokemon[0].addVolatile('fixedDamage')
    /*states[0].state.sim.runEvent('ModifyDamage', states[0].state.sim.getPokemon('p1a: Mew'), states[0].state.sim.getPokemon('p2a: Scyther'), states[0].state.sim.dex.moves.get('Leech Life'), 2)
    states[0].state.sim.events['ModifyDamage'] = makeDamageHandler(2)
    states[0].state.sim.sides[playerNum-1].pokemon[0].volatiles['guaranteeParaFlinch']=guaranteeParaFlinch
    states[0].state.sim.sides[playerNum-1].pokemon[0].volatiles['guaranteeSecondary']=guaranteeSecondary
    states[0].state.sim.sides[playerNum-1].pokemon[0].volatiles['guaranteeMiss']=guaranteeMiss
    states[0].state.sim.sides[playerNum-1].pokemon[0].volatiles['guaranteeHit']=guaranteeHit*/

    //let nextStates = await deterministicNextStates(states[0].state)

    let logLen = 0
    while(true) {
        progress = 0
        maxProgress = 1
        let inpt = await askQuestion('Continue? ')
        if (inpt === 'n')
            break

        let trueState = await cloneDeep(baseState)
        let ret = await resolveTrueState(trueState)
        trueState = ret.state

        let runState = {state:trueState, chance:1}
        console.log(await treeSearch(runState, 3))
    }
}







/* How should the state progress...
1) Calculate damage, status changes from user moves if enemy doesn't switch
2) Calculate damage, status changes from enemy moves if user doesn't switch
3) Calculate damage, status changes from user moves if enemy switches to each known pokemon
4) Calculate damage, status changes from enemy moves if user switches
5) Assume the enemy will take the best choice it can by calculating this

Use the simulator, each state should have a simulator state associated with it
*/






main()