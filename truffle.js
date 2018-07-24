// var HDWalletProvider = require("truffle-hdwallet-provider");
const WalletProvider = require("truffle-wallet-provider");
const Wallet = require('ethereumjs-wallet');
var rinkebyPrivateKey = new Buffer("fb880108d841f5d46ce8d8d947d41b52d3c79fccb7aedad09f0152a231a6402e", "hex");
var rinkebyWallet = Wallet.fromPrivateKey(rinkebyPrivateKey);

// const privKeys = "fb880108d841f5d46ce8d8d947d41b52d3c79fccb7aedad09f0152a231a6402e";
//fb880108d841f5d46ce8d8d947d41b52d3c79fccb7aedad09f0152a231a6402e
var mnemonic = 'argue grab tribe honey envelope exchange space mom dice pet only test';
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
    	network_id: "4",
    	gas: "6000000",
      // gas:'7210484',
      gasPrice: 3000000000  //30Gwei

    },
    rinkeby:{
    	provider: function(){
        return new WalletProvider(rinkebyWallet, "https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo");
    		// return new HDWalletProvider(mnemonic, "https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo");
        // return new PrivateKeyProvider(privKeys, "https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo");
    	},
      from: '0x4cCF8b5c4b53b06216397e79B3D658d2cB08edEe',
    	network_id: "42"/*,
    	gas: "7999992"*/
    },
    mainnet:{
    	provider: function(){
        return new WalletProvider(rinkebyWallet, "https://mainnet.infura.io/noNACTp9gUjXcRV1QsWo");
    		// return new HDWalletProvider(mnemonic, "https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo");
        // return new PrivateKeyProvider(privKeys, "https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo");
    	},
      from: '0x4cCF8b5c4b53b06216397e79B3D658d2cB08edEe',
    	network_id: "1"
    }
    
  }
};
