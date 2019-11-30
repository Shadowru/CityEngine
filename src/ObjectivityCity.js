import World, {world} from './World';
import GeoJSONLayer, {geoJSONLayer} from "./layers/GeoJSONLayer";
import FlatMapLayer, {flatMapLayer} from "./layers/FlatMapLayer"


const OBJECTIVITY = {
    version: '0.1',

    //Public API
    World: World,
    world: world,
    GeoJSONLayer: GeoJSONLayer,
    geoJSONLayer: geoJSONLayer,
    FlatMapLayer: FlatMapLayer,
    flatMapLayer: flatMapLayer
};

export default OBJECTIVITY;
