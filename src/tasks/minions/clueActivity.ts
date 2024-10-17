import { Bank } from 'oldschooljs';

import { ClueTiers } from '../../lib/clues/clueTiers';
import type { ClueActivityTaskOptions } from '../../lib/types/minions';
import { joinStrings } from '../../lib/util';
import { handleTripFinish } from '../../lib/util/handleTripFinish';

export const clueTask: MinionTask = {
	type: 'ClueCompletion',
	async run(data: ClueActivityTaskOptions) {
		const { ci: clueIDs, userID, channelID, q: quantity, implingClues } = data;
		const tiers = clueIDs.map(id => ClueTiers.find(mon => mon.id === id)!);
		const user = await mUserFetch(userID);

		const str = `${user.mention}, ${user.minionName} finished completing ${quantity} ${joinStrings(tiers.map(tier => tier.name))} clues. ${
			user.minionName
		} carefully places the reward casket${quantity > 1 || tiers.length > 1 ? 's' : ''} in your bank.`;

		// Add the number of clues found in implings to CL. Must be on completion to avoid gaming.
		if (implingClues) await user.addItemsToCollectionLog(new Bank().add(tiers[0].scrollID, implingClues));
		const loot = new Bank();
		for (const tier of tiers) {
			loot.add(tier.id, quantity);
		}
		await transactItems({
			userID: user.id,
			collectionLog: true,
			itemsToAdd: loot
		});
		handleTripFinish(user, channelID, str, undefined, data, loot);
	}
};
