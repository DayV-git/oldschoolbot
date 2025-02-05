import type { Prisma } from '@prisma/client';
import { percentChance } from 'e';
import { Bank } from 'oldschooljs';

import { ClueTiers } from '../../../lib/clues/clueTiers';
import {
	birdsNestID,
	clueNestTable,
	nestTable,
	strungRabbitFootNestTable,
	treeSeedsNest
} from '../../../lib/simulation/birdsNest';
import birdhouses from '../../../lib/skilling/skills/hunter/birdHouseTrapping';
import type { BirdhouseData } from '../../../lib/skilling/skills/hunter/defaultBirdHouseTrap';
import { SkillsEnum } from '../../../lib/skilling/types';
import type { BirdhouseActivityTaskOptions } from '../../../lib/types/minions';
import { handleTripFinish } from '../../../lib/util/handleTripFinish';
import { sendToChannelID } from '../../../lib/util/webhook';

export const birdHouseTask: MinionTask = {
	type: 'Birdhouse',
	async run(data: BirdhouseActivityTaskOptions) {
		const { birdhouseName, birdhouseData, userID, channelID, duration, placing, gotCraft, currentDate } = data;

		const user = await mUserFetch(userID);
		let hunterXP = 0;
		let craftingXP = 0;
		const strungRabbitFoot = user.hasEquipped('Strung rabbit foot');
		const loot = new Bank();

		const birdhouse = birdhouses.find(_birdhouse => _birdhouse.name === birdhouseName);
		if (!birdhouse) return;

		if (!placing || !gotCraft) {
			loot.add('Clockwork', 4);
		}

		if (!birdhouseData.birdhousePlaced) {
			let str = `${user}, ${user.minionName} finished placing 4x ${birdhouse.name}.`;

			if (placing && gotCraft) {
				craftingXP = birdhouse.craftXP * 4;
				str += await user.addXP({
					skillName: SkillsEnum.Crafting,
					amount: craftingXP,
					duration: data.duration,
					source: 'Birdhouses'
				});
			}

			const updateBirdhouseData: BirdhouseData = {
				lastPlaced: birdhouse.name,
				birdhousePlaced: true,
				birdhouseTime: currentDate + duration
			};
			await user.update({
				minion_birdhouseTraps: updateBirdhouseData as any as Prisma.InputJsonObject
			});

			str += `\n\n${user.minionName} tells you to come back after your birdhouses are full!`;

			sendToChannelID(channelID, { content: str });
		} else {
			let str = '';
			const birdhouseToCollect = birdhouses.find(_birdhouse => _birdhouse.name === birdhouseData.lastPlaced);
			if (!birdhouseToCollect) return;
			if (placing) {
				str = `${user}, ${user.minionName} finished placing 4x ${birdhouse.name} and collecting 4x full ${birdhouseToCollect.name}.`;
			} else {
				str = `${user}, ${user.minionName} finished collecting 4x full ${birdhouseToCollect.name}.`;
			}

			hunterXP = birdhouseToCollect.huntXP * 4;
			const hunterLevel = user.getSkills(true).hunter;
			const seedNestChance = 0.8 * hunterLevel;
			const nestChance = birdhouseToCollect.baseNestChance * (1 + Math.max(hunterLevel - 50, 0) / 49);
			const lootTableOptions = { tertiaryItemPercentageChanges: user.buildTertiaryItemChanges() };
			const allClues = ClueTiers.map(tier => tier.scrollID);

			for (let i = 0; i < 4; i++) {
				loot.add(birdhouseToCollect.table.roll());
				if (percentChance(seedNestChance)) {
					loot.add(birdsNestID);
					loot.add(treeSeedsNest.roll());
				}
				for (let j = 0; j < 10; j++) {
					if (percentChance(nestChance)) {
						if (!allClues.some(id => loot.has(id))) {
							loot.add(clueNestTable.roll(1, lootTableOptions));
						} else if (strungRabbitFoot) {
							loot.add(strungRabbitFootNestTable.roll());
						} else {
							loot.add(nestTable.roll());
						}
					}
				}
			}

			await transactItems({
				userID: user.id,
				collectionLog: true,
				itemsToAdd: loot
			});

			const xpRes = await user.addXP({
				skillName: SkillsEnum.Hunter,
				amount: hunterXP,
				duration: data.duration,
				source: 'Birdhouses'
			});

			str += `\n\n${xpRes} from collecting the birdhouses.`;

			if (placing && gotCraft) {
				craftingXP = birdhouse.craftXP * 4;
				const xpRes = await user.addXP({
					skillName: SkillsEnum.Crafting,
					amount: craftingXP,
					duration: data.duration,
					source: 'Birdhouses'
				});
				str += `${xpRes} for making own birdhouses.`;
			}

			str += `\n\nYou received: ${loot}.`;

			if (strungRabbitFoot) {
				str += "\nYour strung rabbit foot necklace increases the chance of receiving bird's eggs and rings.";
			}

			let updateBirdhouseData: BirdhouseData = {
				lastPlaced: null,
				birdhousePlaced: false,
				birdhouseTime: 0
			};

			if (placing) {
				updateBirdhouseData = {
					lastPlaced: birdhouse.name,
					birdhousePlaced: true,
					birdhouseTime: currentDate + duration
				};
			}

			await user.update({
				minion_birdhouseTraps: updateBirdhouseData as any as Prisma.InputJsonObject
			});

			if (!placing) {
				str += '\nThe birdhouses have been cleared. The birdhouse spots are ready to have new birdhouses.';
			} else {
				str += `\n${user.minionName} tells you to come back after your birdhouses are full!`;
			}

			handleTripFinish(user, channelID, str, undefined, data, loot);
		}
	}
};
