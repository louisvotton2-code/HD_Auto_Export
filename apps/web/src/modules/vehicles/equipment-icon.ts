import { CONFIGURATION_SEMANTIC_ALIASES, CONFIGURATION_SEMANTIC_KEYS, type ConfigurationSemanticKey } from '@hd/contracts/public';
import type { EquipmentIconName } from './equipment-icon-svg';

/** Stable field keys and three-language labels resolve to the same decorative item glyph. */
const aliases: Partial<Record<EquipmentIconName, readonly string[]>> = {
  engine: ['engine', 'displacementCc', 'engineCc', 'engineKw', 'enginePowerKw', 'cylinders', 'Engine', 'Engine capacity (cc)', 'Engine displacement', 'Engine power (kW)', 'Cylinders', '发动机', '排量（cc）', '发动机排量', '发动机功率（kW）', '气缸数', 'Двигатель', 'Объём двигателя (см³)', 'Мощность двигателя (кВт)', 'Цилиндры'],
  motor: ['motorKw', 'motorPowerKw', 'motorTorqueNm', 'motorLayout', 'motorType', 'motors', 'Motor power (kW)', 'Motor torque (N·m)', 'Motor layout', 'Motor type', 'Number of motors', '电机功率（kW）', '电机扭矩（N·m）', '电机布局', '电机类型', '电机数量', 'Мощность электромотора (кВт)', 'Крутящий момент электромотора (Н·м)', 'Расположение электромоторов', 'Тип электромотора', 'Количество электромоторов'],
  battery: ['batteryKwh', 'batteryType', 'batteryWarranty', 'Battery capacity (kWh)', 'Battery type', 'Battery warranty', '电池容量（kWh）', '电池类型', '电池质保', 'Ёмкость батареи (кВт·ч)', 'Тип батареи', 'Гарантия на батарею'],
  drivetrain: ['driveType', 'drivetrain', 'Drive type', 'Drivetrain', '驱动形式', '驱动方式', 'Тип привода', 'Привод'],
  dimensions: ['lengthMm', 'widthMm', 'heightMm', 'wheelbaseMm', 'Length (mm)', 'Width (mm)', 'Height (mm)', 'Wheelbase (mm)', '车长（mm）', '车宽（mm）', '车高（mm）', '轴距（mm）', 'Длина (мм)', 'Ширина (мм)', 'Высота (мм)', 'Колёсная база (мм)'],
  door: ['doors', 'doorCount', 'Doors', 'Number of doors', '车门数', '车门数量', 'Двери', 'Количество дверей'],
  wheel: ['alloyWheels', 'wheelSize', 'rimSize', 'tyreSize', 'tireSize', 'Alloy wheels', 'Wheel size', 'Rim size', 'Tyre size', 'Tire size', '铝合金轮毂', '轮毂尺寸', '轮胎尺寸', 'Легкосплавные диски', 'Размер колёс', 'Размер дисков', 'Размер шин'],
  seat: ['seats', 'seatMaterial', 'leatherSeats', 'powerDriverSeat', 'powerPassengerSeat', 'Leather seats', 'Power driver seat', 'Power passenger seat', '座椅', '座椅材质', '真皮座椅', '皮革座椅', '主驾驶座椅电动调节', '副驾驶座椅电动调节', 'Кожаные сиденья', 'Кожаный салон', 'Сиденья', 'Электрорегулировка сиденья водителя', 'Электрорегулировка пассажирского сиденья'],
  'seat-heating': ['seatHeating', 'frontSeatHeating', 'rearSeatHeating', 'heatedFrontSeats', 'heatedRearSeats', 'Heated front seats', 'Heated rear seats', 'Heated seats', '座椅加热', '前排座椅加热', '后排座椅加热', 'Подогрев сидений', 'Подогрев передних сидений', 'Подогрев задних сидений'],
  'seat-ventilation': ['seatVentilation', 'frontSeatVentilation', 'driverSeatVentilation', 'passengerSeatVentilation', 'Ventilated driver seat', 'Ventilated passenger seat', 'Ventilated seats', '座椅通风', '前排座椅通风', '主驾驶座椅通风', '副驾驶座椅通风', 'Вентиляция сидений', 'Вентиляция передних сидений', 'Вентиляция сиденья водителя', 'Вентиляция пассажирского сиденья'],
  'seat-memory': ['seatMemory', 'driverSeatMemory', 'Driver seat memory', '座椅记忆', '驾驶位座椅记忆', 'Память сидений', 'Память сиденья водителя'],
  climate: ['airConditioning', 'climateControl', 'automaticAirConditioning', 'Automatic climate control', 'Air conditioning', '空调', '自动空调', '自动恒温空调', 'Климат-контроль', 'Автоматический климат-контроль', 'Кондиционер'],
  'steering-controls': ['steeringWheelControls', 'multiFunctionSteeringWheel', 'Steering wheel controls', 'Power-adjustable steering wheel', '多功能方向盘', '方向盘电动调节', 'Многофункциональный руль', 'Кнопки управления на руле', 'Электрорегулировка рулевой колонки'],
  'steering-wheel': ['heatedSteeringWheel', 'steeringWheelHeating', 'paddleShifters', 'powerSteering', 'Heated steering wheel', 'Paddle shifters', 'Power steering', '方向盘加热', '换挡拨片', '动力转向', 'Подогрев руля', 'Подрулевые лепестки', 'Усилитель руля'],
  'cruise-control': ['cruiseControl', 'adaptiveCruiseControl', 'Adaptive cruise control', 'Cruise control', '定速巡航', '自适应巡航', 'Адаптивный круиз-контроль', 'Круиз-контроль'],
  abs: ['abs', 'antiLockBrakingSystem', 'Anti-lock braking system (ABS)', '防抱死制动系统', '防抱死制动', 'Антиблокировочная система', 'Антиблокировочная система (ABS)'],
  'driver-airbag': ['driverAirbag', 'frontAirbags', 'airbags', 'Driver airbag', 'Airbags', '驾驶座安全气囊', '主驾驶安全气囊', '安全气囊', 'Подушка безопасности водителя', 'Подушки безопасности'],
  'passenger-airbag': ['passengerAirbag', 'Passenger airbag', '副驾驶安全气囊', '前排乘客安全气囊', 'Подушка безопасности пассажира'],
  'curtain-airbag': ['curtainAirbags', 'Curtain airbags', '侧气帘', '头部气囊', 'Шторки безопасности'],
  'side-airbag': ['sideAirbags', 'Side airbags', '侧安全气囊', '侧气囊', 'Боковые подушки безопасности'],
  'parking-sensors-rear': ['rearParkingSensors', 'parkingSensors', 'parkingRadar', 'Rear parking sensors', 'Parking sensors', '后驻车雷达', '后倒车雷达', '倒车雷达', 'Задние парктроники', 'Парктроники', 'Датчики парковки'],
  'parking-sensors-front': ['frontParkingSensors', 'Front parking sensors', '前驻车雷达', '前泊车雷达', 'Передние парктроники'],
  'tire-pressure': ['tpms', 'tirePressureMonitoring', 'tyrePressureMonitoring', 'Tire pressure monitoring (TPMS)', 'Tyre pressure monitoring', '胎压监测', '胎压显示', 'Контроль давления в шинах', 'Система контроля давления в шинах'],
  'stability-control': ['esc', 'esp', 'electronicStabilityControl', 'tractionControl', 'Electronic stability control (ESC)', 'Traction control (TCS)', '车身稳定控制', '车身稳定系统', '牵引力控制', 'Электронная система стабилизации', 'Система курсовой устойчивости', 'Антипробуксовочная система'],
  camera: ['rearViewCamera', 'reversingCamera', 'surroundViewCamera', 'camera360', 'Rear-view camera', 'Reversing camera', 'Surround-view camera', '倒车影像', '后视摄像头', '全景影像', '360度全景影像', 'Камера заднего вида', 'Камеры кругового обзора', 'Круговой обзор'],
  'blind-spot': ['blindSpotMonitoring', 'blindSpotDetection', 'Blind spot monitoring', '盲点监测', '并线辅助', 'Мониторинг слепых зон', 'Контроль слепых зон', 'Контроль мёртвых зон'],
  'lane-departure': ['laneDepartureWarning', 'laneKeepingAssist', 'Lane departure warning (LDWS)', '车道偏离预警', '车道保持辅助', 'Предупреждение о выезде из полосы', 'Контроль полосы движения', 'Удержание в полосе'],
  'parking-brake': ['electronicParkingBrake', 'epb', 'Electronic parking brake (EPB)', '电子驻车', '电子手刹', 'Электронный стояночный тормоз'],
  monitor: ['frontAvMonitor', 'displayScreen', 'touchscreen', 'Front AV monitor', 'Touchscreen', '中控屏', '车载显示屏', '前排液晶屏', 'Передний монитор', 'Сенсорный экран', 'Мультимедийный экран'],
  navigation: ['navigation', 'gps', 'navigationSystem', 'Navigation', '导航', '卫星导航', 'GPS导航', 'Навигация', 'Навигационная система'],
  usb: ['usbPort', 'usb', 'USB port', 'USB接口', 'USB端口', 'USB-порт', 'Разъём USB'],
  bluetooth: ['bluetooth', 'Bluetooth', '蓝牙', '蓝牙连接', 'Блютус'],
  'keyless-entry': ['keylessEntry', 'Keyless entry', '无钥匙进入', 'Бесключевой доступ', 'Система бесключевого доступа'],
  'smart-key': ['smartKey', 'keylessStart', 'Smart key', '智能钥匙', '无钥匙启动', '一键启动', 'Смарт-ключ', 'Интеллектуальный ключ', 'Запуск кнопкой'],
  'door-lock': ['powerDoorLocks', 'centralLocking', 'Power door locks', '中控门锁', '电动门锁', 'Центральный замок'],
  window: ['powerWindows', 'electricWindows', 'Power windows', '电动车窗', 'Электростеклоподъёмники', 'Электрические стеклоподъёмники'],
  'mirror-folding': ['powerFoldingMirrors', 'foldingMirrors', 'Power-folding mirrors', '后视镜电动折叠', '电动折叠后视镜', 'Электроскладывание зеркал', 'Электропривод складывания зеркал'],
  'headlight-hid': ['hidHeadlights', 'xenonHeadlights', 'headlights', 'HID headlights', '氙气大灯', '前大灯', 'Ксеноновые фары', 'Фары'],
  'mirror-dimming': ['autoDimmingMirror', 'ecm', 'Auto-dimming mirror (ECM)', '自动防眩目后视镜', 'Автозатемнение зеркала', 'Автоматическое затемнение зеркала'],
  'rain-sensor': ['rainSensor', 'Rain sensor', '雨量感应', '雨量传感器', '感应雨刷', 'Датчик дождя'],
  'automatic-headlights': ['automaticHeadlights', 'lightSensor', 'Automatic headlights', '自动大灯', '自动头灯', '自动灯光', 'Датчик света', 'Автоматические фары'],
  // A toll transponder is not keyless entry. Keep it neutral until its own glyph exists.
  neutral: ['hiPass', 'Hi-Pass toll system', 'ETC', '自动收费系统'],
};

/** Exhaustive shared vocabulary. Parameters without an accurate existing glyph are deliberately neutral. */
const semanticIcons: Readonly<Record<ConfigurationSemanticKey, EquipmentIconName>> = {
  engine: 'engine', displacementCc: 'engine', engineKw: 'engine', engineHp: 'engine', cylinders: 'engine',
  motorKw: 'motor', motorHp: 'motor', motorTorqueNm: 'motor', motorLayout: 'motor', motorType: 'motor', motors: 'motor',
  powerKw: 'neutral', powerHp: 'neutral', torqueNm: 'neutral', systemKw: 'neutral',
  batteryKwh: 'battery', batteryType: 'battery', batteryWarranty: 'battery',
  rangeKm: 'neutral', fastChargeHours: 'neutral', slowChargeHours: 'neutral', consumptionKwh100km: 'neutral',
  driveType: 'drivetrain', transmissionType: 'neutral', gears: 'neutral',
  lengthMm: 'dimensions', widthMm: 'dimensions', heightMm: 'dimensions', wheelbaseMm: 'dimensions',
  doors: 'door', bodyType: 'neutral',
  curbWeightKg: 'neutral', grossWeightKg: 'neutral', fuelTankL: 'neutral', trunkL: 'neutral',
  alloyWheels: 'wheel', wheelSize: 'wheel', tireSize: 'wheel', frontTireSize: 'wheel', rearTireSize: 'wheel',
  seats: 'seat', seatMaterial: 'seat', leatherSeats: 'seat', powerDriverSeat: 'seat', powerPassengerSeat: 'seat',
  seatHeating: 'seat-heating', frontSeatHeating: 'seat-heating', rearSeatHeating: 'seat-heating',
  seatVentilation: 'seat-ventilation', frontSeatVentilation: 'seat-ventilation', driverSeatVentilation: 'seat-ventilation', passengerSeatVentilation: 'seat-ventilation',
  seatMemory: 'seat-memory', driverSeatMemory: 'seat-memory',
  airConditioning: 'climate', climateControl: 'climate', sunroof: 'neutral',
  steeringWheelControls: 'steering-controls', powerAdjustableSteeringWheel: 'steering-controls',
  heatedSteeringWheel: 'steering-wheel', paddleShifters: 'steering-wheel', powerSteering: 'steering-wheel',
  cruiseControl: 'cruise-control', adaptiveCruiseControl: 'cruise-control', tractionControl: 'stability-control',
  abs: 'abs',
  airbags: 'driver-airbag', driverAirbag: 'driver-airbag', frontAirbags: 'driver-airbag', passengerAirbag: 'passenger-airbag', curtainAirbags: 'curtain-airbag', sideAirbags: 'side-airbag',
  rearParkingSensors: 'parking-sensors-rear', parkingSensors: 'parking-sensors-rear', frontParkingSensors: 'parking-sensors-front',
  tpms: 'tire-pressure', esc: 'stability-control',
  parkingCamera: 'camera', surroundViewCamera: 'camera',
  blindSpotMonitoring: 'blind-spot', laneDepartureWarning: 'lane-departure', laneKeepingAssist: 'lane-departure',
  electronicParkingBrake: 'parking-brake', displayScreen: 'monitor', touchscreen: 'monitor',
  navigation: 'navigation', usbPort: 'usb', bluetooth: 'bluetooth',
  keylessEntry: 'keyless-entry', smartKey: 'smart-key', keylessStart: 'smart-key', centralLocking: 'door-lock',
  powerWindows: 'window', powerFoldingMirrors: 'mirror-folding',
  hidHeadlights: 'headlight-hid', headlights: 'headlight-hid', autoDimmingMirror: 'mirror-dimming',
  rainSensor: 'rain-sensor', automaticHeadlights: 'automatic-headlights', hiPass: 'neutral',
  energyType: 'neutral', emissionStandard: 'neutral', topSpeedKmh: 'neutral', acceleration0to100S: 'neutral',
  fuelConsumptionL100km: 'neutral', launchDate: 'neutral', warranty: 'neutral',
};

// Map lookup avoids treating inherited names such as constructor/toString as glyphs.
const semanticIndex = new Map<string, EquipmentIconName>();
for (const key of CONFIGURATION_SEMANTIC_KEYS) {
  const glyph = semanticIcons[key];
  semanticIndex.set(key, glyph);
  for (const alias of CONFIGURATION_SEMANTIC_ALIASES[key]) {
    if (/^[a-z][A-Za-z0-9]*$/u.test(alias)) semanticIndex.set(alias, glyph);
  }
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
}

const aliasIndex = new Map<string, EquipmentIconName>();
for (const [icon, labels] of Object.entries(aliases)) {
  for (const label of labels) aliasIndex.set(normalized(label), icon as EquipmentIconName);
}
// Producer and consumer share the reviewed vocabulary; keep older qualified labels as compatibility only.
for (const key of CONFIGURATION_SEMANTIC_KEYS) {
  for (const label of [key, ...CONFIGURATION_SEMANTIC_ALIASES[key]]) aliasIndex.set(normalized(label), semanticIcons[key]);
}

/** A non-null key is authoritative. An absent key may use verified labels, never an opaque identity. */
export function equipmentIconName(label: string | null | undefined, fieldId?: string, semanticKey?: string | null): EquipmentIconName {
  if (semanticKey !== undefined && semanticKey !== null) {
    return semanticIndex.get(semanticKey) ?? 'neutral';
  }
  if (!label?.trim()) {
    // Old nameless fields may use a complete known stable ID. No source-prefix/hash guessing.
    return semanticKey === undefined && fieldId ? semanticIndex.get(fieldId) ?? 'neutral' : 'neutral';
  }
  // Exact reviewed aliases only: negative/uncertain phrases must not regain an icon by substring.
  return aliasIndex.get(normalized(label)) ?? 'neutral';
}
