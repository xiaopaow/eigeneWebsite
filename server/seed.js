import "dotenv/config";
import { createPool, initializeDatabase } from "./db.js";

const products = [
  ["PR-W01","Angle One","Woodline","Wood",1,"1-tier","Volca / AIRA Compact / pedals","15 / 30 / 45 degrees","Small desktop devices up to 240 mm deep","A compact single-device stand for the gear you touch most.","Entry fit","/assets/product-wood.svg","Angle One wooden desktop stand",129,"Compact",34,22,17,7,8],
  ["PR-W02","Angle Duo","Woodline","Wood",2,"2-tier","Volca pairs / Boutique pairs / compact drum machines","30-degree lower + 55-degree upper","Two compact devices with rear cable clearance","Two reachable levels without turning the back row into a wall.","Small rigs","/assets/product-wood.svg","Angle Duo two-tier wooden stand",219,"Compact",35,23,27,8,18],
  ["PR-W03","Angle Trio","Woodline","Wood",3,"3-tier","Volca / Boutique / compact synth trios","20 / 35 / 55 degrees","Three compact devices with patch access","A three-level rack that keeps knobs and cables reachable.","Three-device rack","/assets/product-wood.svg","Angle Trio three-tier wooden stand",299,"Compact",36,24,37,9,25],
  ["PR-WE1","Elektron Dock","Woodline","Wood",1,"1-tier","Digitakt / Digitone / Syntakt / Analog Heat","18 or 30 degrees","Decksaver-friendly side panels","A stable medium-box dock for groovebox-first studios.","Core medium box","/assets/product-wood.svg","Elektron wooden desktop dock",119,"Medium",61,32,18,7,8],
  ["PR-WE2","Elektron Duo Dock","Woodline","Wood",2,"2-tier","Two Elektron boxes / Elektron + effects","Low bottom + active upper","Matched widths and rear cable clearance","A two-box performance tower that keeps both machines playable.","Performance pair","/assets/product-wood.svg","Elektron two-tier wooden dock",229,"Medium",62,33,28,8,18],
  ["PR-WXL","DeepDeck Wood XL","Woodline","Wood",2,"1-2 tiers","Hydrasynth Desktop / Peak / TR-8S","Low center-of-gravity tilt","Deep devices with anti-tip rear brace","A wider wood option for serious desktop modules.","Large modules","/assets/product-wood.svg","DeepDeck XL wooden stand",289,"Large",86,44,26,8,18],
  ["PR-M01","FlexFrame Small","SteelSeries","Metal",3,"1-3 tiers","Small synths and compact controllers","Multi-hole angle ladder","Width-adjustable frame for compact gear","Metal adjustability for rigs that keep changing.","Adjustable small","/assets/product-steel.svg","FlexFrame small metal stand",159,"Compact",38,23,36,9,25],
  ["PR-M02","FlexFrame Medium","SteelSeries","Metal",3,"1-3 tiers","Elektron / SP-404 / MPC / controllers","15-60 degrees","Medium frame with optional second shelf","A universal metal stand for common desktop boxes.","Universal medium","/assets/product-steel.svg","FlexFrame medium metal stand",189,"Medium",58,32,37,9,25],
  ["PR-M03","FlexFrame Large","SteelSeries","Metal",2,"1-2 tiers","Hydrasynth / Peak / MPC Live","Shallow performance tilt","Deep arms, wide crossbar and anti-tip foot","Built for deep, heavy devices and wide control surfaces.","Heavy desktop","/assets/product-steel.svg","FlexFrame large metal stand",249,"Large",79,47,29,8,18],
  ["PR-MT2","SteelStack Two","SteelSeries","Metal",2,"2-tier","Mixed drum machine + synth setups","Lower flat, upper angled","Modular side plates and cable bay","A two-level workhorse for daily production desks.","Two-tier workhorse","/assets/product-steel.svg","SteelStack two-tier stand",249,"Medium",60,34,26,8,18],
  ["PR-K32","KeyStation 32","Hybrid","Wood + Metal",3,"Workstation","32-key controllers / Push / Maschine","Top shelf + desk bridge","Wide shelf with power and cable zone","Turns the desk into a playable production station.","Desk workstation","/assets/product-hybrid.svg","KeyStation hybrid workstation",449,"Medium",83,42,38,9,30],
  ["PR-CB","CableBridge Kit","Accessories","Metal / Wood",1,"Add-on","All PatchReach stands","Under-shelf routing","Slots, hooks and under-bridge channel","A small add-on that turns vertical space into cable calm.","Cable management","/assets/product-accessory.svg","CableBridge management kit",39,"Compact",42,12,6,10,5]
];

const pool = createPool();
await initializeDatabase(pool);
for (let index = 0; index < products.length; index += 1) {
  const row = products[index];
  await pool.query(`
    INSERT INTO products
      (sku,name,collection,material,tier_count,tier_label,device,angle,fit,description,tag,
       image_url,image_alt,price_from,footprint,width_cm,depth_cm,height_cm,cable_gap_cm,
       load_kg,status,sort_order)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'published',$21)
    ON CONFLICT (sku) DO UPDATE SET
      name=EXCLUDED.name, collection=EXCLUDED.collection, material=EXCLUDED.material,
      tier_count=EXCLUDED.tier_count, tier_label=EXCLUDED.tier_label, device=EXCLUDED.device,
      angle=EXCLUDED.angle, fit=EXCLUDED.fit, description=EXCLUDED.description, tag=EXCLUDED.tag,
      image_url=EXCLUDED.image_url, image_alt=EXCLUDED.image_alt, price_from=EXCLUDED.price_from,
      footprint=EXCLUDED.footprint, width_cm=EXCLUDED.width_cm, depth_cm=EXCLUDED.depth_cm,
      height_cm=EXCLUDED.height_cm, cable_gap_cm=EXCLUDED.cable_gap_cm, load_kg=EXCLUDED.load_kg,
      sort_order=EXCLUDED.sort_order, updated_at=NOW()
  `, [...row, index * 10]);
}
console.log(`Seeded ${products.length} PatchReach products.`);
await pool.end();
