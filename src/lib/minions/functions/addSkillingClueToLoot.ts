import { percentChance } from 'e';
import type { Bank } from 'oldschooljs';

import type { CATier } from '../../combat_achievements/combatAchievements';
import {
	birdsNestID,
	eggNest,
	nestTable,
	ringNests,
	strungRabbitFootNestTable,
	treeSeedsNest
} from '../../simulation/birdsNest';
import { SkillsEnum } from '../../skilling/types';
import { GearBank } from '../../structures/GearBank';
import { LootTable, roll } from '../../util';

export default function addSkillingClueToLoot(
	user: MUser | GearBank,
	skill: SkillsEnum,
	quantity: number,
	clueChance: number,
	loot: Bank,
	clueNestsOnly?: boolean,
	strungRabbitFoot?: boolean,
	twitcherSetting?: string,
	wcCapeNestBoost?: boolean
) {
	const userLevel = user instanceof GearBank ? user.skillsAsLevels[skill] : user.skillLevel(skill);
	const nestChance = wcCapeNestBoost ? Math.floor(256 * 0.9) : 256;
	let nests = 0;

	const twitcherChance = skill === SkillsEnum.Woodcutting && twitcherSetting === 'clue' ? 0.8 : 1.0;

	const clues = [
		{ tier: 'elite', weight: 10 },
		{ tier: 'hard', weight: 3.3 },
		{ tier: 'medium', weight: 2 },
		{ tier: 'easy', weight: 1.7 },
		{ tier: 'beginner', weight: 0.2 }
	];

	const clueTable = new LootTable();
	clues.forEach(({ tier, weight }) => {
		const ca = tier !== 'beginner' && user.hasCompletedCATier(tier as CATier) ? 0.95 : 1.0;
		const rate = Math.floor((weight * Math.floor(clueChance * twitcherChance * ca)) / (100 + userLevel));
		clueTable.tertiary(rate, new LootTable().every(birdsNestID).every(`Clue scroll (${tier})`));
	});
	loot.add(clueTable.roll(quantity));

	for (let i = 0; i < quantity; i++) {
		if (skill === SkillsEnum.Woodcutting && !clueNestsOnly && roll(nestChance)) {
			if (twitcherSetting && percentChance(20)) {
				switch (twitcherSetting) {
					case 'egg':
						loot.add(eggNest.roll());
						nests++;
						continue;
					case 'seed':
						loot.add(treeSeedsNest.roll());
						nests++;
						continue;
					case 'ring':
						loot.add(ringNests.roll());
						nests++;
						continue;
				}
			} else if (strungRabbitFoot) {
				loot.add(strungRabbitFootNestTable.roll());
			} else {
				loot.add(nestTable.roll());
			}
		}
	}
	if (skill === SkillsEnum.Woodcutting) {
		loot.add(birdsNestID, nests);
	}
	return loot;
}
