#!/usr/bin/env node

/*
* Usage: node deployTokens.js 
* --gas-price-gwei 3  # 部署时的gas价格
* --rpc-url http://localhost:7545  # 部署时使用的节点 
* --priv-key-file ./7f8c  # 部署token使用的钱包的私钥文件。
*
* 部署产生的4个token, 分别对应到xxx_config.json文件中的字段，完成整个合约的部署。
* 
node deployTokens.js --gas-price-gwei 3 --rpc-url https://rinkeby.infura.io/noNACTp9gUjXcRV1QsWo --priv-key-file ./897ee 
0x50bbaf6b5f3da83e402604bc81c4cd6760551a8d3e8baf80202809ad718d0a27

from 0x897eeaF88F2541Df86D61065e34e7Ba13C111CB8
nonce 420
solc.version
0.4.24+commit.e67f0147.Emscripten.clang
chainId 4
starting compilation
undefined
finished compilation
waiting for balance to account 0x897eeaF88F2541Df86D61065e34e7Ba13C111CB8
received 82711881169060928701 wei
deploying test token
token CRP address 0x6536d0e3b7A81caFaa9828b4178f5b52c7Fcec0c
token TAC address 0x85463a3d9fc4298D79CAe0688570F37C6fE33aFB
token MESH address 0xd77EF92ED3439E51767219626C9df2Dfe7acaCed
token SMT address 0xC48774A357f46C2b81dc27AA272c8495CfEe4837

------------------------
0x50bbaf6b5f3da83e402604bc81c4cd6760551a8d3e8baf80202809ad718d0a27

from 0x897eeaF88F2541Df86D61065e34e7Ba13C111CB8
nonce 596
solc.version
0.4.24+commit.e67f0147.Emscripten.clang
chainId 4
starting compilation
undefined
finished compilation
waiting for balance to account 0x897eeaF88F2541Df86D61065e34e7Ba13C111CB8
received 72524350677060928701 wei
deploying test token
token CRP address 0xBA9a49E5bE7B25D5936DEAdbfdeCaD9243F35331
token TAC address 0xC2bBFcf63F5421dBfbF9ad46C886C58ad4498518
token MESH address 0x706065cd2D4F1E427FB910E7Bc433ad58247a5ef
token SMT address 0x0829023dd6dDf7Bbf0de1A6c6968b68971890F58


* 把上述tokens地址更新到rinkeby_config.json文件，开始部署rinkeby的合约。
*/

const Web3 = require("web3");
const fs = require("fs");
const path = require('path');
const RLP = require('rlp');
const BigNumber = require('bignumber.js')

process.on('unhandledRejection', console.error.bind(console))

const { gasPriceGwei, rpcUrl, privKeyFile} = require('yargs')
    .usage('Usage: $0 --gas-price-gwei [gwei] --rpc-url [url] --priv-key-file [privKeyFile]')
    .demandOption(['gasPriceGwei', 'rpcUrl', 'privKeyFile'])
    .boolean('printPrivateKey')
    .boolean('dontSendTx')
    .argv;

const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
const solc = require('solc')

// const rand = web3.utils.randomHex(7);
// let privateKey = web3.utils.sha3("js sucks" + rand);
const privateKey = "0x"+fs.readFileSync(privKeyFile)

const account = web3.eth.accounts.privateKeyToAccount(privateKey);
console.log(privateKey);
const sender = account.address;
const gasPrice = BigNumber(gasPriceGwei).mul(10 ** 9);
const signedTxs = [];
let nonce;
let chainId;

console.log("from",sender);

async function sendTx(txObject) {
    const txTo = txObject._parent.options.address;

    let gasLimit;
    try {
        gasLimit = await txObject.estimateGas();
    }
    catch (e) {
        gasLimit = 500 * 1000;
    }

    if(txTo !== null) {
    gasLimit = 500 * 1000;
}

    //console.log(gasLimit);
    const txData = txObject.encodeABI();
    const txFrom = account.address;
    const txKey = account.privateKey;

    const tx = {
        from : txFrom,
        to : txTo,
        nonce : nonce,
        data : txData,
        gas : gasLimit,
        chainId,
        gasPrice
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, txKey);
    nonce++;
    // don't wait for confirmation
    signedTxs.push(signedTx.rawTransaction)
    web3.eth.sendSignedTransaction(signedTx.rawTransaction, {from:sender});
}

async function deployContract(solcOutput, contractName, ctorArgs) {

    const actualName = contractName;
    const bytecode = solcOutput.contracts[actualName].bytecode;

    const abi = solcOutput.contracts[actualName].interface;
    const myContract = new web3.eth.Contract(JSON.parse(abi));
    const deploy = myContract.deploy({data:"0x" + bytecode, arguments: ctorArgs});
    let address = "0x" + web3.utils.sha3(RLP.encode([sender,nonce])).slice(12).substring(14);
    address = web3.utils.toChecksumAddress(address);

    await sendTx(deploy);

    myContract.options.address = address;

    return [address,myContract];
}

const contractPath = path.join(__dirname, "../contracts/");
const zeppelinPath = path.join(__dirname, "../node_modules/zeppelin-solidity/contracts/");

const input = {
    "TestToken.sol" : fs.readFileSync(contractPath + 'mockContracts/TestToken.sol', 'utf8'),
    "zeppelin-solidity/contracts/math/SafeMath.sol": fs.readFileSync(zeppelinPath + "math/SafeMath.sol", "utf8"),
    "zeppelin-solidity/contracts/token/ERC20/StandardToken.sol": fs.readFileSync(zeppelinPath + "token/ERC20/StandardToken.sol", "utf8"),
    "zeppelin-solidity/contracts/token/ERC20/BasicToken.sol": fs.readFileSync(zeppelinPath + "token/ERC20/BasicToken.sol", "utf8"),
    "zeppelin-solidity/contracts/token/ERC20/ERC20Basic.sol": fs.readFileSync(zeppelinPath + "token/ERC20/ERC20Basic.sol", "utf8"),
    "zeppelin-solidity/contracts/token/ERC20/ERC20.sol": fs.readFileSync(zeppelinPath + "token/ERC20/ERC20.sol", "utf8")
};

let output;
let bigNum;

async function main() {

//    bigNum = web3.utils.toBN(10**25);
//    bigNum = bigNum.pow(10);
//    console.log(bigNum);
//    return;

    nonce = await web3.eth.getTransactionCount(sender);
    console.log("nonce",nonce);

    console.log('solc.version')
    console.log(solc.version())

    chainId = chainId || await web3.eth.net.getId()
    console.log('chainId', chainId);

    console.log("starting compilation");
    output = await solc.compile({ sources: input }, 1);
    console.log(output.errors);
    console.log("finished compilation");

    await waitForEth();

    let contractInst;
    let address;

    console.log("deploying test token");

    let crpToken = {};
    crpToken.symbol = "CRP";
    crpToken.name = "CRP";
    crpToken.decimals = 18;
    await deployToken(crpToken)

    let kncToken = {};
    kncToken.symbol = "TAC";
    kncToken.name = "Tac";
    kncToken.decimals = 18;
    await deployToken(kncToken);

    let eosToken = {};
    eosToken.symbol = "MESH";
    eosToken.name = "MeshBox";
    eosToken.decimals = 18;
    await deployToken(eosToken);

    let omgToken = {};
    omgToken.symbol = "SMT";
    omgToken.name = "SMT";
    omgToken.decimals = 18;
    await deployToken(omgToken)

}


async function deployToken (token) {
    [token.address, token.inst] = await deployContract(output, "TestToken.sol:TestToken",
            [token.name, token.symbol, token.decimals]);

    console.log("token " + token.symbol + " address " + token.address.toString());
}

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function waitForEth() {
  while(true) {
    const balance = await web3.eth.getBalance(sender);
    console.log("waiting for balance to account " + sender);
    if(balance.toString() !== "0") {
      console.log("received " + balance.toString() + " wei");
      return;
    }
    else await sleep(10000)
  }
}


main()