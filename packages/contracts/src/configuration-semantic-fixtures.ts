import type {ConfigurationSemanticKey} from './configuration-semantics.js';
/** Shared generator/consumer examples. Both apps verify the same semantic result; no production inventory or UI geometry. */
export const CONFIGURATION_SEMANTIC_FIXTURES:ReadonlyArray<{
 id:string;labels:readonly [string,string,string];semanticKey:ConfigurationSemanticKey|null;
}> = [
 {id:'supplier:frontSeatHeating',labels:['前排座椅加热','Heated front seats','Подогрев передних сидений'],semanticKey:'frontSeatHeating'},
 {id:'equipment.0.0',labels:['座椅通风','Ventilated seats','Вентиляция сидений'],semanticKey:'seatVentilation'},
 {id:'equipment.0.1',labels:['座椅记忆','Seat memory','Память сидений'],semanticKey:'seatMemory'},
 {id:'sheet.0.navigation',labels:['导航','Navigation','Навигация'],semanticKey:'navigation'},
 {id:'equipment.0.2',labels:['胎压监测','Tire pressure monitoring (TPMS)','Система контроля давления в шинах (TPMS)'],semanticKey:'tpms'},
 {id:'equipment.0.3',labels:['倒车影像','Rear-view camera','Камера заднего вида'],semanticKey:'parkingCamera'},
 {id:'specs.engineHp',labels:['发动机马力','Engine horsepower','Мощность двигателя (л.с.)'],semanticKey:'engineHp'},
 {id:'specs.ev.motorHp',labels:['电机马力','Motor horsepower','Мощность электромотора (л.с.)'],semanticKey:'motorHp'},
 {id:'equipment.0.4',labels:['前排座椅通风（三级）','Ventilated front seats','Вентилируемые передние сиденья'],semanticKey:'frontSeatVentilation'},
 {id:'equipment.0.5',labels:['主驾驶座椅通风','Ventilated driver seat','Вентиляция сиденья водителя'],semanticKey:'driverSeatVentilation'},
 {id:'equipment.0.6',labels:['副驾驶座椅通风','Ventilated passenger seat','Вентиляция пассажирского сиденья'],semanticKey:'passengerSeatVentilation'},
 {id:'equipment.0.7',labels:['后排座椅加热','Heated rear seats','Подогрев задних сидений'],semanticKey:'rearSeatHeating'},
 {id:'equipment.0.8',labels:['卫星导航','Navigation system','Навигационная система'],semanticKey:'navigation'},
 {id:'equipment.0.9',labels:['自适应巡航','Adaptive cruise control with stop and go','Адаптивный круиз-контроль'],semanticKey:'adaptiveCruiseControl'},
 {id:'specs.ev.motorPowerKw',labels:['其他配置','Other feature','Другая опция'],semanticKey:'motorKw'},
 {id:'opaque-vehicle-calibration',labels:['未识别校准项','Unrecognized calibration setting','Неизвестная калибровка'],semanticKey:null},
 {id:'constructor',labels:['其他','Other','Другое'],semanticKey:null},
];
