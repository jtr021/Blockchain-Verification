import hre from "hardhat";
import * as fs from 'fs';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contract with account: " , deployer.address);

  const DataIntFactory = await ethers.getContractFactory("DataInt");
  const dataInt = await DataIntFactory.deploy();
  await dataInt.waitForDeployment();

 
  const deployedAddress = await dataInt.getAddress();
  console.log("DataInt deployed to:", deployedAddress);
  const contractOwner = await dataInt.owner();
  console.log("Deployer address: ", contractOwner);

  const addresses = { DataInt: deployedAddress };
  fs.writeFileSync("deployedAddresses.json", JSON.stringify(addresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
