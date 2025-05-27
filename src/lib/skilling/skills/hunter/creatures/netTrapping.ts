import { LootTable } from 'oldschooljs';

import type { Creature } from '../../../types';
import { HunterTechniqueEnum } from '../../../types';

const netTrappingCreatures: Creature[] = [
	{
		name: 'Swamp lizard',
		id: 23,
		aliases: ['swamp lizard'],
		level: 29,
		hunterXP: 152,
		table: new LootTable().every('Swamp lizard'),
		huntTechnique: HunterTechniqueEnum.NetTrapping,
		multiTraps: true,
		catchTime: 26,
		slope: 1,
		intercept: 15,
		tier: ['novice', 'adept']
	},
	{
		name: 'Orange salamander',
		id: 24,
		aliases: ['orange salamander'],
		level: 47,
		hunterXP: 224,
		table: new LootTable().every('Orange salamander'),
		huntTechnique: HunterTechniqueEnum.NetTrapping,
		multiTraps: true,
		catchTime: 35,
		slope: 1.2,
		intercept: 5,
		tier: ['novice', 'adept', 'expert']
	},
	{
		name: 'Red salamander',
		id: 25,
		aliases: ['red salamander'],
		level: 59,
		hunterXP: 272,
		table: new LootTable().every('Red salamander'),
		huntTechnique: HunterTechniqueEnum.NetTrapping,
		multiTraps: true,
		catchTime: 40,
		slope: 0.9,
		intercept: 25,
		tier: ['novice', 'adept', 'expert', 'master']
	},
	{
		name: 'Black salamander',
		id: 26,
		aliases: ['Black salamander'],
		level: 67,
		hunterXP: 319.2,
		table: new LootTable().every('Black salamander'),
		huntTechnique: HunterTechniqueEnum.NetTrapping,
		multiTraps: true,
		wildy: true,
		prayerLvl: 43,
		catchTime: 48,
		slope: 1.2,
		intercept: -5
	},
	{
		name: 'Tecu salamander',
		id: 47,
		aliases: ['tecu salamander'],
		level: 79,
		hunterXP: 344,
		table: new LootTable().add('Immature tecu salamander', 1, 999).add('Tecu salamander', 1, 1),
		huntTechnique: HunterTechniqueEnum.NetTrapping,
		multiTraps: true,
		catchTime: 46,
		slope: 0.9,
		intercept: -5.9,
		tier: ['novice', 'expert', 'master']
	}
];

export default netTrappingCreatures;
