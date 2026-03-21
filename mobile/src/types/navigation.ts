export type RootStackParamList = {
  index: undefined;
  setup: undefined;
  game: { config: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
