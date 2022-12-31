// Manual adjust "visible" connections to provide "unobstructed" connections -
// defined as connections that are reasonable for a robot to move, i.e. not through furniture or windows etc.
// declare a bunch of variable we will need later
let ix = -1;
let scan;
let camera,
  scene,
  controls,
  renderer,
  connections,
  name_to_id,
  cylinderFrame,
  arrowFrame,
  model,
  airbert,
  vlnbert,
  line_frame;
let split = "val_unseen";
let dollhouse, raycaster, download_data;
let mouse = new THREE.Vector2();
let selected = null;
let deleted = null;
let pathId2scan = {};
let connectivities = {};
let vln = {};
let mesh = {};

// Directory containing Matterport data
const DATA_DIR = "assets/matterport_mesh/v1/scans/";
const connectivityPath = "assets/connectivity/";
const SIZE_X = 960; // 960
const SIZE_Y = 540; // 540
const VFOV = 70;
const ASPECT = SIZE_X / SIZE_Y; // 1920.0/1080.0;

// Marker colors
const START_COLOR = 0xffff61;
const GROUND_TRUTH_COLOR = 0x00ff00;
const AIRBERT_COLOR = 0x00ffff;
const VLNBERT_COLOR = 0xff00ff;

const SELECTED = 0xff0000;
const TARGET = 0xff0000;
const START = 0x00ff00;
const CNODE = 0x43971e;

const matt = new Matterport3D(DATA_DIR);

// load all data
const meshUrl = "assets/data/mesh_names.json";
const resultUrl = (split, dataset, model) =>
  `assets/data/${model}_${dataset}_results_${split}.json`;
const vlnUrl = (split, dataset) =>
  `assets/data/${dataset.toUpperCase()}_${split}.json`;
let dataset = "r2r";

const loadData = (meshUrl, split) => {
  /**
   * Load main JSON files
   */
  Promise.all([
    d3.json(meshUrl),
    d3.json(resultUrl(split, dataset, "airbert")),
    d3.json(resultUrl(split, dataset, "vlnbert")),
    d3.json(vlnUrl(split, dataset)),
  ])
    .then(([_mesh, _airbert, _vlnbert, _vln]) => {
      airbert = _airbert;
      vlnbert = _vlnbert;

      const scans = new Set();
      _mesh.forEach((item) => {
        mesh[item[0]] = item[1];
        scans.add(item[0]);
      });
      loadConnectivities([...scans]);

      _vln.forEach((item) => {
        pathId2scan[`${item.path_id}`] = item.scan;
        item.instructions.forEach((_, i) => {
          if (dataset == "r2r") {
            vln[`${item.path_id}_${i}`] = item;
          } else if (dataset == "reverie") {
            vln[`${item.path_id}_${item.objId}_${i}`] = item;
          }
        });
      });
      const numSamples = Object.keys(vln).length;
      d3.select("#num_samples").text(numSamples);
    })
    .catch((error) => console.warn(error));
};

const loadConnectivities = (scans) => {
  /**
   * Load every connectivity JSON files
   * Create a dict with image_id and item
   */
  const files = scans.map(
    (scan) => `${connectivityPath}/${scan}_connectivity.json`
  );
  const promises = files.map((file) => d3.json(file));
  Promise.all(promises).then((data) => {
    data.forEach((con) =>
      con.forEach(
        (viewpoint) => (connectivities[viewpoint.image_id] = viewpoint)
      )
    );
    d3.select("#go").attr("disabled", null);
    d3.select("#go").attr("class", "ui primary button");
  });
};

function go() {
  ix = parseInt(d3.select("#index").property("value"));

  // clean
  if (dollhouse) scene.remove(dollhouse);
  arrowFrame.remove.apply(arrowFrame, arrowFrame.children);

  // update textual fields on the page
  instrId = airbert[ix].instr_id;
  const splits = instrId.split("_");
  pathId = splits[0];
  scan = pathId2scan[pathId];
  const meshName = mesh[scan];
  d3.select("#scan_id").text(ix);
  d3.select("#scan_name").text(scan);
  d3.select("#instr_id").text(instrId);
  stcId = parseInt(splits[splits.length - 1]);
  instr = vln[instrId].instructions[stcId];
  if (dataset == "reverie") {
    d3.select("#obj_id").text(
      `GT: ${vln[instrId].objId}, Air: ${airbert[ix].predObjId}`
    );
  }
  d3.select("#instr").text(instr);
  d3.select("#stat").style("display", "block");
  d3.select("#go").attr("disabled", true);

  // load the object
  matt.load_mesh(scan, meshName, function (object) {
    dollhouse = object;
    object.name = "env";
    scene.add(object);

    // add a circle for starting
    const groundTruth = vln[instrId].path;
    addShape(
      new THREE.CylinderBufferGeometry(0.5, 0.5, 0.01, 128),
      START_COLOR,
      connectivities[groundTruth[0]]["pose"]
    );

    const doGroundTruth = d3.select("#ground_truth").property("checked");
    const doAirbert = d3.select("#airbert").property("checked");
    const doVlnbert = d3.select("#vlnbert").property("checked");
    let offset;

    if (doGroundTruth) {
      offset = new THREE.Vector3(0, 0, 0);
      loadTrajectory(groundTruth, GROUND_TRUTH_COLOR, connectivities, offset);
    }

    if (doVlnbert) {
      let pred = vlnbert[ix].trajectory.map((traj) => traj[0]);
      offset = new THREE.Vector3(0.05, 0.05, 0.02);
      // FIXME an issue on the test.py??
      pred = pred.slice(0, -1);
      loadTrajectory(pred, VLNBERT_COLOR, connectivities, offset);
    }

    if (doAirbert) {
      offset = new THREE.Vector3(-0.05, -0.05, 0.04);
      pred = airbert[ix].trajectory.map((traj) => traj[0]);
      pred = pred.slice(0, -1);
      loadTrajectory(pred, AIRBERT_COLOR, connectivities, offset);
    }

    render();
  });
}

function download() {
  renderer.render(scene, camera);
  aLink = document.createElement("a");
  evt = document.createEvent("HTMLEvents");
  evt.initEvent("click", true, true);
  aLink.download = `${split}_${instrId}_${ix}.png`;
  aLink.href = renderer.domElement
    .toDataURL()
    .replace("image/png", "image/octet-stream");
  aLink.dispatchEvent(
    new MouseEvent("click", {bubbles: true, cancelable: true, view: window})
  );
}
// ## Initialize everything
function init() {
  if (controls) {
    controls.dispose();
  } else {
    // movement
    document.addEventListener("keydown", onDocumentKeyDown, false);
  }

  // test if webgl is supported
  if (!Detector.webgl) Detector.addGetWebGLMessage();

  // create the Scene
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(VFOV, ASPECT, 1, 1000);
  camera.position.z = 20; //20;
  camera.position.x = 0;
  camera.position.y = 10;
  scene.add(camera);

  var light = new THREE.DirectionalLight(0x888888, 1);
  light.position.set(0, 0, 100);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x888888)); // soft light

  // Create a cylinder frame for holding moveto positions
  cylinderFrame = new THREE.Object3D();
  line_frame = new THREE.Object3D();
  cylinderFrame.add(line_frame);
  scene.add(cylinderFrame);

  // Hold arrows
  arrowFrame = new THREE.Object3D();
  line_frame = new THREE.Object3D();
  arrowFrame.add(line_frame);
  scene.add(arrowFrame);

  raycaster = new THREE.Raycaster();

  // init the WebGL renderer
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    canvas: document.getElementById("skybox"),
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE_X, SIZE_Y);

  controls = new THREE.PTZCameraControls(camera, renderer.domElement);
  controls.translate = true;
  controls.minZoom = 1;
  controls.maxZoom = 3.0;
  controls.minTilt = (-0.6 * Math.PI) / 2;
  controls.maxTilt = (0.6 * Math.PI) / 2;
  controls.enableDamping = true;
  controls.panSpeed = 2;
  controls.tiltSpeed = 2;
  controls.zoomSpeed = 1.5;
  controls.dampingFactor = 0.5;
  // controls.addEventListener("select", select);
  controls.addEventListener("change", render);
}

function onDocumentKeyDown(event) {
  var keyCode = event.which;
  // up
  if (keyCode == 38) {
    event.preventDefault();
    camera.position.z += 1;
    // down
  } else if (keyCode == 40) {
    event.preventDefault();
    camera.position.z -= 1;
    // left
  } else if (keyCode == 37) {
    event.preventDefault();
    camera.near += 0.5;
    // right
  } else if (keyCode == 39) {
    event.preventDefault();
    camera.near -= 0.5;
    if (camera.near < 0) camera.near = 0.1;
    // space
  } else if (keyCode == 32) {
    event.preventDefault();
    if (selected) {
      toggle_node(selected);
    }
    // escape
  } else if (keyCode == 27) {
    event.preventDefault();
    controls.translate = !controls.translate;
    controls.panSpeed *= -1;
    controls.tiltSpeed *= -1;
  }
  camera.updateProjectionMatrix();
  render();
}

const addShape = (geometry, color, pose, offset = null) => {
  const material = new THREE.MeshLambertMaterial({
    color: color,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  for (var k = 0; k < pose.length; k++) pose[k] = parseFloat(pose[k]);
  var m = new THREE.Matrix4();
  m.fromArray(pose);
  m.transpose(); // switch row major to column major to suit three.js

  mesh.applyMatrix4(m);

  if (offset) {
    const translation = new THREE.Matrix4().makeTranslation(
      offset.x,
      offset.y,
      offset.z
    );
    mesh.applyMatrix4(translation);
    console.log(translation);
  }

  return mesh;
};

const boxMesh = (pointX, pointY, color) => {
  // edge from X to Y
  const direction = new THREE.Vector3().subVectors(pointY, pointX);
  const material = new THREE.MeshBasicMaterial({
    color: color,
  });
  // Make the geometry (of "direction" length)
  length = direction.length() - 0.6;
  const geometry = new THREE.BoxGeometry(0.01, 0.2, length);
  // shift it so one end rests on the origin
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, length / 2));
  // rotate it the right way for lookAt to work
  // geometry.applyMatrix4(
  //   new THREE.Matrix4().makeRotationX(THREE.Math.degToRad(90))
  // );
  // Make a mesh with the geometry
  const mesh = new THREE.Mesh(geometry, material);
  // Position it where we want
  mesh.position.copy(pointX);
  // And make it point to where we want
  mesh.lookAt(pointY);

  arrowFrame.add(mesh);

  return mesh;
};

const loadTrajectory = (trajectory, color, connectivities, offset) => {
  /**
   * A trajectory is a list of viewpoints.
   */
  // get X, Y, Z positions for each viewpoint
  const positions = [];
  for (let i = 0; i < trajectory.length; i++) {
    const info = connectivities[trajectory[i]];
    const pose = info["pose"];
    for (var k = 0; k < pose.length; k++) pose[k] = parseFloat(pose[k]);

    const m = new THREE.Matrix4();
    m.fromArray(pose);
    m.transpose(); // switch row major to column major to suit three.js

    const xyz = new THREE.Vector3();
    xyz.setFromMatrixPosition(m);
    xyz.add(offset);

    positions.push(xyz);
  }

  // create arrows in between each location
  for (let i = 0; i < trajectory.length - 1; i++) {
    addArrow(positions[i], positions[i + 1], color);
  }

  // add a square for ending
  addShape(
    new THREE.BoxGeometry(0.8, 0.01, 0.8, 128),
    color,
    connectivities[trajectory[trajectory.length - 1]]["pose"],
    offset
  );
};

const addArrow = (source, target, color) => {
  const src = new THREE.Vector3(source.x, source.y, source.z);
  const trg = new THREE.Vector3(target.x, target.y, target.z);

  const dir = new THREE.Vector3().subVectors(trg, src);
  const length = dir.length() - 0.35;
  const hex = color;
  const headLength = 0.5;
  const headWidth = 0.5;
  const arrowHelper = new THREE.ArrowHelper(
    dir.normalize(),
    src,
    length,
    hex,
    headLength,
    headWidth
  );
  arrowFrame.add(arrowHelper);

  // create a cylinder over the line
  box = boxMesh(src, trg, color);
  arrowFrame.add(box);
};

// ## Display the Scene
function render() {
  renderer.render(scene, camera);
}

loadData(meshUrl, split);
init();
