import type { EquipmentIconName } from './equipment-icon-svg';

/** Stable field keys and three-language labels resolve to the same decorative item glyph. */
const aliases: Partial<Record<EquipmentIconName, readonly string[]>> = {
  seat: ['seats', 'seatMaterial', 'leatherSeats', 'powerDriverSeat', 'powerPassengerSeat', 'Leather seats', 'Power driver seat', 'Power passenger seat', '座椅', '座椅材质', '真皮座椅', '皮革座椅', '主驾驶座椅电动调节', '副驾驶座椅电动调节', 'Кожаные сиденья', 'Кожаный салон', 'Сиденья', 'Электрорегулировка сиденья водителя', 'Электрорегулировка пассажирского сиденья'],
  'seat-heating': ['seatHeating', 'frontSeatHeating', 'rearSeatHeating', 'heatedFrontSeats', 'heatedRearSeats', 'Heated front seats', 'Heated rear seats', 'Heated seats', '座椅加热', '前排座椅加热', '后排座椅加热', 'Подогрев сидений', 'Подогрев передних сидений', 'Подогрев задних сидений'],
  'seat-ventilation': ['seatVentilation', 'frontSeatVentilation', 'driverSeatVentilation', 'passengerSeatVentilation', 'Ventilated driver seat', 'Ventilated passenger seat', 'Ventilated seats', '座椅通风', '前排座椅通风', '主驾驶座椅通风', '副驾驶座椅通风', 'Вентиляция сидений', 'Вентиляция передних сидений', 'Вентиляция сиденья водителя', 'Вентиляция пассажирского сиденья'],
  'seat-memory': ['seatMemory', 'driverSeatMemory', 'Driver seat memory', '座椅记忆', '驾驶位座椅记忆', 'Память сидений', 'Память сиденья водителя'],
  climate: ['airConditioning', 'climateControl', 'automaticAirConditioning', 'Automatic climate control', 'Air conditioning', '空调', '自动空调', '自动恒温空调', 'Климат-контроль', 'Автоматический климат-контроль', 'Кондиционер'],
  'steering-controls': ['steeringWheelControls', 'multiFunctionSteeringWheel', 'Steering wheel controls', 'Power-adjustable steering wheel', '多功能方向盘', '方向盘电动调节', 'Многофункциональный руль', 'Кнопки управления на руле', 'Электрорегулировка рулевой колонки'],
  'steering-wheel': ['heatedSteeringWheel', 'steeringWheelHeating', 'paddleShifters', 'powerSteering', 'Heated steering wheel', 'Paddle shifters', 'Power steering', '方向盘加热', '换挡拨片', '动力转向', 'Подогрев руля', 'Подрулевые лепестки', 'Усилитель руля'],
  'cruise-control': ['cruiseControl', 'adaptiveCruiseControl', 'tractionControl', 'Adaptive cruise control', 'Cruise control', 'Traction control (TCS)', '定速巡航', '自适应巡航', '牵引力控制', 'Адаптивный круиз-контроль', 'Круиз-контроль', 'Антипробуксовочная система'],
  abs: ['abs', 'antiLockBrakingSystem', 'Anti-lock braking system (ABS)', '防抱死制动系统', '防抱死制动', 'Антиблокировочная система', 'Антиблокировочная система (ABS)'],
  'driver-airbag': ['driverAirbag', 'frontAirbags', 'airbags', 'Driver airbag', 'Airbags', '驾驶座安全气囊', '主驾驶安全气囊', '安全气囊', 'Подушка безопасности водителя', 'Подушки безопасности'],
  'passenger-airbag': ['passengerAirbag', 'Passenger airbag', '副驾驶安全气囊', '前排乘客安全气囊', 'Подушка безопасности пассажира'],
  'curtain-airbag': ['curtainAirbags', 'Curtain airbags', '侧气帘', '头部气囊', 'Шторки безопасности'],
  'side-airbag': ['sideAirbags', 'Side airbags', '侧安全气囊', '侧气囊', 'Боковые подушки безопасности'],
  'parking-sensors-rear': ['rearParkingSensors', 'parkingSensors', 'parkingRadar', 'Rear parking sensors', 'Parking sensors', '后驻车雷达', '后倒车雷达', '倒车雷达', 'Задние парктроники', 'Парктроники', 'Датчики парковки'],
  'parking-sensors-front': ['frontParkingSensors', 'Front parking sensors', '前驻车雷达', '前泊车雷达', 'Передние парктроники'],
  'tire-pressure': ['tpms', 'tirePressureMonitoring', 'tyrePressureMonitoring', 'alloyWheels', 'Tire pressure monitoring (TPMS)', 'Tyre pressure monitoring', 'Alloy wheels', '胎压监测', '胎压显示', '铝合金轮毂', 'Контроль давления в шинах', 'Система контроля давления в шинах', 'Легкосплавные диски'],
  'stability-control': ['esc', 'esp', 'electronicStabilityControl', 'Electronic stability control (ESC)', '车身稳定控制', '车身稳定系统', 'Электронная система стабилизации', 'Система курсовой устойчивости'],
  camera: ['rearViewCamera', 'reversingCamera', 'surroundViewCamera', 'camera360', 'Rear-view camera', 'Reversing camera', 'Surround-view camera', '倒车影像', '后视摄像头', '全景影像', '360度全景影像', 'Камера заднего вида', 'Камеры кругового обзора', 'Круговой обзор'],
  'blind-spot': ['blindSpotMonitoring', 'blindSpotDetection', 'Blind spot monitoring', '盲点监测', '并线辅助', 'Мониторинг слепых зон', 'Контроль слепых зон', 'Контроль мёртвых зон'],
  'lane-departure': ['laneDepartureWarning', 'laneKeepingAssist', 'Lane departure warning (LDWS)', '车道偏离预警', '车道保持辅助', 'Предупреждение о выезде из полосы', 'Контроль полосы движения', 'Удержание в полосе'],
  'parking-brake': ['electronicParkingBrake', 'epb', 'Electronic parking brake (EPB)', '电子驻车', '电子手刹', 'Электронный стояночный тормоз'],
  monitor: ['frontAvMonitor', 'displayScreen', 'touchscreen', 'Front AV monitor', 'Touchscreen', '中控屏', '车载显示屏', '前排液晶屏', 'Передний монитор', 'Сенсорный экран', 'Мультимедийный экран'],
  navigation: ['navigation', 'gps', 'navigationSystem', 'Navigation', '导航', '卫星导航', 'GPS导航', 'Навигация', 'Навигационная система'],
  usb: ['usbPort', 'usb', 'USB port', 'USB接口', 'USB端口', 'USB-порт', 'Разъём USB'],
  bluetooth: ['bluetooth', 'Bluetooth', '蓝牙', '蓝牙连接', 'Блютус'],
  'keyless-entry': ['keylessEntry', 'hiPass', 'Hi-Pass toll system', 'Keyless entry', '无钥匙进入', 'ETC', '自动收费系统', 'Бесключевой доступ', 'Система бесключевого доступа'],
  'smart-key': ['smartKey', 'keylessStart', 'Smart key', '智能钥匙', '无钥匙启动', '一键启动', 'Смарт-ключ', 'Интеллектуальный ключ', 'Запуск кнопкой'],
  'door-lock': ['powerDoorLocks', 'centralLocking', 'Power door locks', '中控门锁', '电动门锁', 'Центральный замок'],
  window: ['powerWindows', 'electricWindows', 'Power windows', '电动车窗', 'Электростеклоподъёмники', 'Электрические стеклоподъёмники'],
  'mirror-folding': ['powerFoldingMirrors', 'foldingMirrors', 'Power-folding mirrors', '后视镜电动折叠', '电动折叠后视镜', 'Электроскладывание зеркал', 'Электропривод складывания зеркал'],
  'headlight-hid': ['hidHeadlights', 'xenonHeadlights', 'headlights', 'HID headlights', '氙气大灯', '前大灯', 'Ксеноновые фары', 'Фары'],
  'mirror-dimming': ['autoDimmingMirror', 'ecm', 'Auto-dimming mirror (ECM)', '自动防眩目后视镜', 'Автозатемнение зеркала', 'Автоматическое затемнение зеркала'],
  'rain-sensor': ['rainSensor', 'Rain sensor', '雨量感应', '雨量传感器', '感应雨刷', 'Датчик дождя'],
  'automatic-headlights': ['automaticHeadlights', 'lightSensor', 'Automatic headlights', '自动大灯', '自动头灯', '自动灯光', 'Датчик света', 'Автоматические фары'],
};

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
}

const aliasIndex = new Map<string, EquipmentIconName>();
for (const [icon, labels] of Object.entries(aliases)) {
  for (const label of labels) aliasIndex.set(normalized(label), icon as EquipmentIconName);
}

const patterns: readonly [EquipmentIconName, RegExp][] = [
  ['seat-ventilation', /(?:seat.*ventilat|ventilat.*seat|座椅.*通风|通风.*座椅|вентиляци.*сиден|вентилируем.*сиден|сиден.*вентиляци)/iu],
  ['seat-heating', /(?:seat.*heat|heat.*seat|座椅.*加热|加热.*座椅|(?:подогрев|обогрев).*сиден|сиден.*(?:подогрев|обогрев))/iu],
  ['seat-memory', /(?:seat.*memory|memory.*seat|座椅.*记忆|память.*сиден)/iu],
  ['steering-wheel', /(?:steering.*(?:heat|paddle)|方向盘.*加热|подогрев.*рул)/iu],
  ['parking-sensors-front', /(?:front.*(?:parking|radar)|前.*(?:驻车|泊车|雷达)|передн.*парктроник)/iu],
  ['parking-sensors-rear', /(?:parking.*(?:sensor|radar|distance)|rear.*radar|倒车雷达|驻车雷达|парктроник|датчик.*парков|парковочн.*(?:датчик|радар))/iu],
  ['tire-pressure', /(?:t[iy]re.*pressure|\btpms\b|胎压|давлени.*шин)/iu],
  ['camera', /(?:rear(?:.view)?.*camera|revers.*camera|surround.*view|倒车.*(?:影像|摄像)|全景影像|камера.*заднего|кругово.*обзор)/iu],
  ['navigation', /(?:\bnavigation\b|\bgps\b|导航|навигац)/iu],
  ['climate', /(?:air.condition|climate.control|空调|климат.контрол|кондиционер)/iu],
  ['cruise-control', /(?:cruise.control|巡航|круиз.контрол)/iu],
  ['blind-spot', /(?:blind.spot|盲点|并线辅助|слепых.зон|мёртвых.зон)/iu],
  ['lane-departure', /(?:lane.*(?:departure|keeping)|车道.*(?:偏离|保持)|полос.*движен|удержан.*полос)/iu],
  ['seat', /(?:leather.*seat|power.*seat|seat.*adjust|真皮.*座椅|座椅.*调节|кожан.*(?:сиден|салон)|электро.*сиден)/iu],
  ['bluetooth', /(?:bluetooth|蓝牙|блютус)/iu],
  ['usb', /(?:\busb\b)/iu],
  ['rain-sensor', /(?:rain.sensor|雨量|感应雨刷|датчик.дожд)/iu],
];

/** An ID wins only when it is a known semantic key; arbitrary hashes never guess a feature. */
export function equipmentIconName(label: string | null | undefined, fieldId?: string): EquipmentIconName {
  if (fieldId) {
    const key = aliasIndex.get(normalized(fieldId)) ?? aliasIndex.get(normalized(fieldId.split(/[:/.]/u).at(-1) ?? ''));
    if (key) return key;
  }
  if (!label?.trim()) return 'neutral';
  const key = aliasIndex.get(normalized(label));
  return key ?? patterns.find(([, pattern]) => pattern.test(label))?.[0] ?? 'neutral';
}
