import { Typography } from 'antd';
import styles from './site-analytics.module.css';

export function CountryInferenceSource() {
  return <Typography.Paragraph className={styles.hint}>
    可识别的国家或地区根据 IP 推断。{' '}
    <Typography.Link href="https://db-ip.com/" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</Typography.Link>
  </Typography.Paragraph>;
}
