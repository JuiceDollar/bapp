import { gql, useQuery } from "@apollo/client";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import { CONFIG } from "@config";

const PONDER_URL = CONFIG.chain === "mainnet" ? CONFIG.ponder.mainnet : CONFIG.ponder.testnet;
const ponderClient = new ApolloClient({
	uri: PONDER_URL,
	cache: new InMemoryCache(),
});

export const useTotalSavingsUsers = () => {
	// Query the SavingsStats entity which contains aggregated user count
	const { data, loading, error } = useQuery(
		gql`
			{
				savingsStats(id: "global") {
					totalUsers
					lastUpdated
				}
			}
		`,
		{
			client: ponderClient,
			pollInterval: 60000, // Poll every 60 seconds
			fetchPolicy: "cache-and-network",
		}
	);

	const totalUsers = data?.savingsStats?.totalUsers || 0;

	return {
		totalUsers,
		loading,
		error,
	};
};
