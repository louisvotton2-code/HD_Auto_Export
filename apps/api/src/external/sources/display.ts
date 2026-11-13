import type {DisplayText,Locale} from '@hd/contracts/public';
import {displayText,isPublicText} from '../normalize.js';
export function sourceDisplay(value:unknown,locale:Locale):DisplayText{
 const text=typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'?String(value):typeof value==='string'?value.trim():'';
 if(!text||text.length>500||!isPublicText(text))return displayText(locale,null);
 const neutral=/^[\d\s.,+\-/%]+(?:(?:mm|cm³|cm|m|kg|kW|hp|Nm|kWh|km|L|s|h|V|A)(?:\/(?:100)?(?:km|h))?)?$/.test(text);
 const language=neutral?'und':/\p{Script=Han}/u.test(text)?'zh':/\p{Script=Cyrillic}/u.test(text)?'ru':/[A-Za-z]/.test(text)?'en':'und';
 return displayText(locale,{text,contentLocale:language},'supplier');
}
type Label=[string,string,string,string?];
const labels:Record<string,Label>={
 abs:['防抱死系统','ABS','ABS'],seatHeating:['座椅加热','Seat heating','Подогрев сидений'],airbags:['安全气囊','Airbags','Подушки безопасности'],cruiseControl:['定速巡航','Cruise control','Круиз-контроль'],parkingCamera:['倒车影像','Parking camera','Камера заднего вида'],parkingSensors:['泊车雷达','Parking sensors','Парктроник'],sunroof:['天窗','Sunroof','Люк'],airConditioning:['空调','Air conditioning','Кондиционер'],
 displacementCc:['排量','Displacement','Рабочий объём','cm³'],powerKw:['功率','Power','Мощность','kW'],powerHp:['功率（配置表）','Power (specification)','Мощность (спецификация)','hp'],torqueNm:['扭矩','Torque','Крутящий момент','Nm'],engineKw:['发动机功率','Engine power','Мощность двигателя','kW'],motorKw:['电机功率','Motor power','Мощность электромотора','kW'],systemKw:['系统功率','System power','Мощность системы','kW'],energyType:['能源类型','Energy type','Тип энергии'],emissionStandard:['排放标准','Emission standard','Экологический стандарт'],cylinders:['气缸数','Cylinders','Число цилиндров'],transmissionType:['变速箱','Transmission','Коробка передач'],gears:['挡位数','Gears','Число передач'],driveType:['驱动方式','Drive','Привод'],bodyType:['车身类型','Body type','Тип кузова'],doors:['车门数','Doors','Число дверей'],seats:['座位数','Seats','Число мест'],lengthMm:['车长','Length','Длина','mm'],widthMm:['车宽','Width','Ширина','mm'],heightMm:['车高','Height','Высота','mm'],wheelbaseMm:['轴距','Wheelbase','Колёсная база','mm'],curbWeightKg:['整备质量','Curb weight','Снаряжённая масса','kg'],grossWeightKg:['总质量','Gross weight','Полная масса','kg'],fuelTankL:['油箱容积','Fuel tank','Топливный бак','L'],trunkL:['行李箱容积','Trunk volume','Объём багажника','L'],topSpeedKmh:['最高速度','Top speed','Максимальная скорость','km/h'],acceleration0to100S:['百公里加速','0–100 km/h','Разгон 0–100 км/ч','s'],fuelConsumptionL100km:['油耗','Fuel consumption','Расход топлива','L/100km'],launchDate:['上市日期','Launch date','Дата выпуска модели'],warranty:['质保','Warranty','Гарантия'],batteryKwh:['电池容量','Battery capacity','Ёмкость батареи','kWh'],batteryType:['电池类型','Battery type','Тип батареи'],batteryWarranty:['电池质保','Battery warranty','Гарантия на батарею'],consumptionKwh100km:['电耗','Energy consumption','Расход энергии','kWh/100km'],fastChargeHours:['快充时间','Fast charging','Быстрая зарядка','h'],slowChargeHours:['慢充时间','Slow charging','Медленная зарядка','h'],motorLayout:['电机布局','Motor layout','Расположение электромотора'],motorPowerKw:['电机功率','Motor power','Мощность электромотора','kW'],motorTorqueNm:['电机扭矩','Motor torque','Крутящий момент электромотора','Nm'],motorType:['电机类型','Motor type','Тип электромотора'],motors:['电机数','Motors','Число электромоторов'],rangeKm:['续航里程','Range','Запас хода','km']
};
const enumLabels:Record<string,Label>={petrol:['汽油','Petrol','Бензин'],gasoline:['汽油','Petrol','Бензин'],diesel:['柴油','Diesel','Дизель'],electric:['纯电','Electric','Электрический'],hybrid:['混合动力','Hybrid','Гибрид'],'plug-in hybrid':['插电混动','Plug-in hybrid','Подключаемый гибрид'],automatic:['自动','Automatic','Автоматическая'],manual:['手动','Manual','Механическая'],standard:['标配','Standard','Стандарт'],optional:['选配','Optional','Опция'],yes:['是','Yes','Да'],no:['否','No','Нет']};
const index=(locale:Locale)=>locale==='zh'?0:locale==='en'?1:2;
export function specificationDisplay(key:string,value:unknown,locale:Locale){
 const label=labels[key];if(!label||value===null||value===undefined||value==='')return null;
 let output=value;
 if(typeof value==='string'&&enumLabels[value.toLowerCase()])output=enumLabels[value.toLowerCase()]![index(locale)];
 if(label[3]&&(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)))output=`${value} ${label[3]}`;
 const name=displayText(locale,{text:label[index(locale)],contentLocale:locale},'catalog'),display=sourceDisplay(output,locale);
 return display.status==='missing'?null:{name,value:typeof value==='string'&&enumLabels[value.toLowerCase()]?{...display,provenance:'catalog' as const}:display};
}

export function namedSpecificationDisplay(name:unknown,value:unknown,locale:Locale){
 if(typeof name!=='string')return null;const key=Object.keys(labels).find(key=>key.toLowerCase()===name.toLowerCase()||labels[key]!.slice(0,3).some(label=>label?.toLowerCase()===name.trim().toLowerCase()));
 return key?specificationDisplay(key,value,locale):null;
}
