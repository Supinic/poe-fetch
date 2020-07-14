(async () => {
	process.env.MARIA_USER = "cron-job-poe";
	process.env.MARIA_HOST = "localhost";
	process.env.MARIA_PASSWORD = "penis123";
	process.env.MARIA_CONNECTION_LIMIT = 50;

	const { CronJob } = require("cron");

	await require("supi-core")("sb", {
		whitelist: [
			"objects/date",
			"objects/error",
			"objects/url-params",
			"singletons/query",
			"classes/got",
		],

		skipData: [
			"classes/got"
		]
	});

	sb.Exile = {
		job: null,
		fetchCurrency: true,
		types: [],
		items: await sb.Query.getRecordset(rs => rs.select("*").from("poe", "Item")),
		leagues: ["Harvest", "Hardcore Harvest"],
		newItemsBatch: await sb.Query.getBatch("poe", "Item", ["Trade_ID", "Name_ID", "Name", "Type"]),
		priceBatch: await sb.Query.getBatch("poe", "Price", ["Item", "League", "Chaos_Equivalent"]),
	};

	sb.Exile.job = new CronJob("0 0 3 * * *", async function pathOfExileCron () {
		const prices = [];
		for (const league of sb.Exile.leagues) {
			const leagueID = await sb.Query.getRecordset(rs => rs
				.select("ID")
				.from("poe", "League")
				.where("Name = %s", league)
				.single()
				.flat("ID")
			);

			if (sb.Exile.fetchCurrency) {
				const { body: data } = await sb.Got({
					responseType: "json",
					url: "https://poe.ninja/api/data/currencyoverview",
					searchParams: new sb.URLParams()
						.set("league", league)
						.set("type", "Currency")
						.set("language", "en")
						.toString()
				});

				for (const currency of data.currencyDetails) {
					const item = sb.Exile.items.find(i => i.Trade_ID === currency.poeTradeId);
					if (!item) {
						sb.Exile.newItemsBatch.add({
							Trade_ID: currency.poeTradeId,
							Name_ID: currency.tradeId,
							Name: currency.name,
							Type: "Currency"
						});
					}
				}

				await sb.Exile.newItemsBatch.insert({ ignore: true });

				for (const price of data.lines) {
					const item = sb.Exile.items.find(i => i.Name === price.currencyTypeName);
					if (!item) {
						continue;
					}

					prices.push({
						Item: item.ID,
						League: leagueID,
						Chaos_Equivalent: price.chaosEquivalent
					});
				}
			}

			for (const type of sb.Exile.types) {
				// @todo
			}
		}

		for (const price of prices) {
			sb.Exile.priceBatch.add(price);
		}
		
		const timestamp = new sb.Date();
		await sb.Exile.priceBatch.insert({ ignore: true });
		await sb.Query.batchUpdate(prices, (ru, row) => ru
			.update("poe", "Price")
			.set("Chaos_Equivalent", row.Chaos_Equivalent)
			.set("Timestamp", timestamp)
			.where("Item = %n", row.Item)
			.where("League = %n", row.League)
		);
	});

	sb.Exile.job.start();
})();