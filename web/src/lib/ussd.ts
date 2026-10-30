/**
 * The USSD session, as a pure state machine.
 *
 * It lives outside the React component so it can be replayed in a test and so
 * the menu a judge taps on stage is provably the same one a caller would use.
 */

export type UssdStep = "idle" | "crop" | "district" | "quantity" | "result";

export interface UssdState {
  step: UssdStep;
  cropId: string;
  districtId: string;
  page: number;
  quantity: number;
}

export const USSD_QUANTITIES = [100, 500, 1000, 5000];

export function initialUssdState(cropId: string): UssdState {
  return { step: "idle", cropId, districtId: "", page: 0, quantity: 500 };
}

export function ussdPress(
  state: UssdState,
  key: string,
  ctx: { cropIds: string[]; districts: string[] }
): UssdState {
  switch (state.step) {
    case "idle":
      return key === "1" ? { ...state, step: "crop" } : state;

    case "crop": {
      const cropId = ctx.cropIds[Number(key) - 1];
      return cropId ? { ...state, cropId, districtId: "", page: 0, step: "district" } : state;
    }

    case "district": {
      if (key === "0") return { ...state, step: "crop" };
      if (key === "9") {
        const nextPage = state.page + 1;
        return ctx.districts.length > nextPage * 8 ? { ...state, page: nextPage } : state;
      }
      const districtId = ctx.districts.slice(state.page * 8, state.page * 8 + 8)[Number(key) - 1];
      return districtId ? { ...state, districtId, step: "quantity" } : state;
    }

    case "quantity": {
      if (key === "0") return { ...state, step: "district" };
      const quantity = USSD_QUANTITIES[Number(key) - 1];
      return quantity ? { ...state, quantity, step: "result" } : state;
    }

    case "result":
      return key === "0"
        ? { ...state, step: "idle", districtId: "", page: 0 }
        : state;
    default:
      return state;
  }
}
