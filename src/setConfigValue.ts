export default (configValue: string | undefined): string | undefined => {
  return (configValue && process.env[configValue]) || configValue;
};
