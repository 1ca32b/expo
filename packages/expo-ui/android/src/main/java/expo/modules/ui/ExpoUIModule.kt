package expo.modules.ui

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.ui.button.Button

class ExpoUIModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoUI")

    // Defines a single view for now – a single choice segmented control
    View(PickerView::class) {
      Events("onOptionSelected")
    }

    View(SwitchView::class) {
      Events("onCheckedChanged")
    }

    View(Button::class) {
      Events("onButtonPressed")
    }

    View(BottomSheetView::class) {
      Events("onSheetClosed")
    }

    View(SliderView::class) {
      Events("onValueChanged")
    }
  }
}
