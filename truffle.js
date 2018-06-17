module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // to customize your Truffle configuration!
    networks: {
    development: {
        host: "127.0.0.1",
        port: 7545,
        network_id: "*"
    },
    geth:{
    	host: "127.0.0.1",
		port: 8545,
    	network_id: "999",
    	gas: "46123880"
    },
    kovan:{
    	provider: function(){
    		return new HDWalletProvider(mnemonic, "https://kovan.infura.io/noNACTp9gUjXcRV1QsWo");
    	},
    	network_id: "42",
    	gas: "10000000"
    }
  }
};
